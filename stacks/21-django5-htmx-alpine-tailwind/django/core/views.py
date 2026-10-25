"""Stack 21 views: four screens (server-rendered) + /api/v1 JSON envelope.

Two surfaces, one session auth:
- Web: Django templates + htmx partial responses (HX-Request header decides
  fragment vs full page). CSRF via the standard hidden token + X-CSRFToken
  header for htmx.
- API: pure Django JSON views with the {ok,data,error,requestId} envelope.
  CSRF: GET /api/v1/csrf returns the token; state-changing calls echo it as
  X-CSRFToken (SessionAuthentication-style contract).
"""

from __future__ import annotations

import functools
import json
from typing import Any

from django.contrib.auth import authenticate  # noqa: F401 (kept for parity docs)
from django.contrib.auth import get_user_model, login as django_login, logout as django_logout
from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods, require_GET, require_POST

from core import algorithms
from core.envelope import (
    ERR_EMAIL_TAKEN,
    ERR_INPUT_TOO_LARGE,
    ERR_INVALID_CREDENTIALS,
    ERR_METHOD,
    ERR_NOT_FOUND,
    ERR_SERVER,
    ERR_THROTTLED,
    ERR_UNKNOWN_ALGORITHM,
    ERR_UNAUTHENTICATED,
    ERR_VALIDATION,
    error_response,
    success_response,
    validation_error,
)
from core.forms import AlgorithmRunForm, LoginForm, NoteForm, RegisterForm
from core.models import Note
from core.throttle import LoginThrottle

from django.conf import settings
from django.db import IntegrityError

User = get_user_model()


# --- Shared helpers -----------------------------------------------------------


def is_htmx(request: HttpRequest) -> bool:
    return request.headers.get("HX-Request") == "true"


def web_login_required(view):
    """login_required variant that speaks htmx.

    Anonymous htmx requests get 401 + HX-Redirect (a plain 302 would make htmx
    swap the login page into the fragment target); anonymous full-page requests
    redirect to the login screen as usual.
    """

    @functools.wraps(view)
    def wrapped(request: HttpRequest, *args, **kwargs):
        if request.user.is_authenticated:
            return view(request, *args, **kwargs)
        if is_htmx(request):
            response = HttpResponse(status=401)
            response["HX-Redirect"] = "/login/"
            return response
        return redirect("/login/?flash=login-required")

    return wrapped


def api_login_required(view):
    """Enveloped 401 for anonymous API access (session-cookie auth)."""

    @functools.wraps(view)
    def wrapped(request: HttpRequest, *args, **kwargs):
        if not request.user.is_authenticated:
            return error_response(request, status=401, code=ERR_UNAUTHENTICATED)
        return view(request, *args, **kwargs)

    return wrapped


_throttle = LoginThrottle(
    limit=getattr(settings, "LOGIN_THROTTLE_LIMIT", 5),
    window_seconds=getattr(settings, "LOGIN_THROTTLE_WINDOW_SECONDS", 60),
)


def _attempt_login(email: str, password: str):
    """Credential check with enumeration parity.

    Returns (user, None) or (None, ERR_INVALID_CREDENTIALS). Unknown email and
    wrong password produce the same code and message; an unknown email still
    runs one hasher round so response timing does not leak existence.

    Deliberately NOT cached: the lookup must run on every attempt. Caching
    (user, error) results would retain plaintext passwords in process memory
    as cache keys, serve stale User state after a password change or
    deactivation, and skip the timing equalization on cache hits.
    """
    from django.contrib.auth.hashers import check_password, make_password

    try:
        user = User.objects.get(email__iexact=email.strip())
    except User.DoesNotExist:
        # Burn one hash round against a fixed non-secret hash so the unknown-
        # email path costs about the same as the wrong-password path.
        check_password(password, make_password("timing-equalizer"))
        return None, ERR_INVALID_CREDENTIALS
    if not user.is_active or not user.check_password(password):
        return None, ERR_INVALID_CREDENTIALS
    return user, None


def _form_error_details(form) -> list[dict[str, str]]:
    details: list[dict[str, str]] = []
    for field, errors in form.errors.items():
        for message in errors:
            details.append({"field": field, "message": message})
    return details


def _parse_json_body(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    if not request.body:
        return {}, None
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, validation_error(
            request, [{"field": "body", "message": "Request body must be valid JSON."}]
        )
    if not isinstance(payload, dict):
        return None, validation_error(
            request, [{"field": "body", "message": "Request body must be a JSON object."}]
        )
    return payload, None


# --- Root + health ------------------------------------------------------------


@require_GET
def healthz(request: HttpRequest) -> JsonResponse:
    return success_response(request, data={"status": "ok"})


def home_redirect(request: HttpRequest) -> HttpResponse:
    return redirect("/home/" if request.user.is_authenticated else "/login/")


# --- Web: four screens ----------------------------------------------------------


@ensure_csrf_cookie
def register_view(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("/home/")

    if request.method == "POST":
        form = RegisterForm(request.POST)
        if form.is_valid():
            email = form.cleaned_data["email"]
            if User.objects.filter(email__iexact=email).exists():
                form.add_error("email", "This email is already registered.")
            else:
                user = User.objects.create_user(
                    email=email,
                    password=form.cleaned_data["password"],
                )
                django_login(request, user)  # rotates the session key (fixation-safe)
                if is_htmx(request):
                    response = HttpResponse(status=204)
                    response["HX-Redirect"] = "/home/"
                    return response
                return redirect("/home/")
        if is_htmx(request):
            return render(
                request,
                "fragments/register_form.html",
                {"form": form},
                status=422,
            )
        return render(request, "register.html", {"form": form}, status=422)

    form = RegisterForm()
    template = "fragments/register_form.html" if is_htmx(request) else "register.html"
    return render(request, template, {"form": form})


@ensure_csrf_cookie
def login_view(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("/home/")

    if request.method == "POST":
        form = LoginForm(request.POST)
        ip = _throttle.client_ip(request)
        if form.is_valid():
            email = form.cleaned_data["email"]
            allowed, retry_after = _throttle.check(email, ip)
            if not allowed:
                return _throttled_response(request, retry_after, "fragments/login_form.html", {"form": form})
            user, error_code = _attempt_login(email, form.cleaned_data["password"])
            if user is not None:
                _throttle.record_success(email, ip)
                django_login(request, user)
                if is_htmx(request):
                    response = HttpResponse(status=204)
                    response["HX-Redirect"] = "/home/"
                    return response
                return redirect("/home/")
            _throttle.record_failure(email, ip)
            form.add_error(None, "Invalid email or password.")
        if is_htmx(request):
            return render(request, "fragments/login_form.html", {"form": form}, status=422)
        return render(request, "login.html", {"form": form}, status=422)

    form = LoginForm()
    template = "fragments/login_form.html" if is_htmx(request) else "login.html"
    return render(request, template, {"form": form})


def _throttled_response(request: HttpRequest, retry_after: int, fragment: str, context: dict) -> HttpResponse:
    """429 for both full-page and htmx mode (htmx-config meta swaps the body)."""
    context["retry_after"] = retry_after
    context["throttled"] = True
    template = fragment if is_htmx(request) else fragment.replace("fragments/", "").replace("_form", "")
    response = render(request, template, context, status=429)
    response["Retry-After"] = str(max(1, int(retry_after)))
    return response


@web_login_required
def home_view(request: HttpRequest) -> HttpResponse:
    notes = request.user.notes.all()
    metrics = {
        "noteCount": notes.count(),
        "algorithmCount": len(algorithms.catalog()),
    }
    context = {
        "metrics": metrics,
        "notes": notes,
        "note_form": NoteForm(),
    }
    if is_htmx(request):
        return render(request, "fragments/home_main.html", context)
    return render(request, "home.html", context)


@web_login_required
@require_POST
def note_create_view(request: HttpRequest) -> HttpResponse:
    form = NoteForm(request.POST)
    if form.is_valid():
        Note.objects.create(
            owner=request.user,
            title=form.cleaned_data["title"],
            body=form.cleaned_data["body"],
        )
        form = NoteForm()  # reset for the re-rendered section
    notes = request.user.notes.all()
    context = {"notes": notes, "note_form": form, "metrics": {"noteCount": notes.count(), "algorithmCount": len(algorithms.catalog())}}
    status = 422 if form.errors else 200
    if is_htmx(request):
        return render(request, "fragments/home_main.html", context, status=status)
    return redirect("/home/")


@web_login_required
@require_POST
def note_delete_view(request: HttpRequest, note_id: int) -> HttpResponse:
    note = request.user.notes.filter(pk=note_id).first()
    if note is not None:
        note.delete()
    notes = request.user.notes.all()
    context = {"notes": notes, "note_form": NoteForm(), "metrics": {"noteCount": notes.count(), "algorithmCount": len(algorithms.catalog())}}
    if is_htmx(request):
        return render(request, "fragments/home_main.html", context)
    return redirect("/home/")


@web_login_required
def algorithm_view(request: HttpRequest) -> HttpResponse:
    form = AlgorithmRunForm(
        choices=[(a["name"], a["title"]) for a in algorithms.catalog()],
        max_input_chars=settings.MAX_INPUT_CHARS,
    )
    result = None
    if request.method == "POST":
        form = AlgorithmRunForm(
            request.POST,
            choices=[(a["name"], a["title"]) for a in algorithms.catalog()],
            max_input_chars=settings.MAX_INPUT_CHARS,
        )
        if form.is_valid():
            name = form.cleaned_data["algorithm"]
            payload = form.cleaned_data["payload"]
            if len(payload) > settings.MAX_INPUT_CHARS:
                form.add_error("payload", "Input exceeds the 10,000 character limit.")
            elif not algorithms.known(name):
                form.add_error("algorithm", "Unknown algorithm requested.")
            else:
                try:
                    output, duration_ms, complexity = algorithms.run(name, payload)
                    result = {
                        "algorithm": name,
                        "output": output,
                        "durationMs": duration_ms,
                        "complexity": complexity,
                    }
                except ValueError as exc:
                    form.add_error("payload", str(exc))
    context = {
        "catalog": algorithms.catalog(),
        "form": form,
        "result": result,
    }
    if is_htmx(request):
        return render(request, "fragments/run_result.html", context, status=200 if result else 422)
    return render(request, "algorithm.html", context, status=200 if result else (422 if request.method == "POST" else 200))


@require_POST
def logout_view(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        django_logout(request)  # deletes the server-side session row
    if is_htmx(request):
        response = HttpResponse(status=204)
        response["HX-Redirect"] = "/login/"
        return response
    return redirect("/login/?flash=logged-out")


def csrf_failure(request, reason=""):
    """CSRF failures: enveloped 403 on the API, plain page on the web."""
    if request.path.startswith("/api/"):
        return error_response(request, status=403, code="CSRF_FAILURE")
    return render(request, "csrf_failure.html", status=403)


# --- API: /api/v1 ----------------------------------------------------------------


@ensure_csrf_cookie
@require_GET
def api_csrf(request: HttpRequest) -> JsonResponse:
    token = request.META.get("CSRF_COOKIE") or ""
    if not token:
        from django.middleware.csrf import get_token

        token = get_token(request)
    return success_response(request, data={"csrfToken": token, "headerName": "X-CSRFToken"})


@require_http_methods(["POST"])
def api_register(request: HttpRequest) -> JsonResponse:
    payload, err = _parse_json_body(request)
    if err is not None:
        return err
    form = RegisterForm(payload)
    if not form.is_valid():
        return validation_error(request, _form_error_details(form))
    email = form.cleaned_data["email"]
    if User.objects.filter(email__iexact=email).exists():
        # Persistence layer owns uniqueness; the API surfaces a stable code.
        return error_response(request, status=422, code=ERR_EMAIL_TAKEN)
    try:
        user = User.objects.create_user(
            email=email,
            password=form.cleaned_data["password"],
        )
    except IntegrityError:
        # Raced a concurrent registration: the unique index is the arbiter.
        return error_response(request, status=422, code=ERR_EMAIL_TAKEN)
    django_login(request, user)
    return success_response(
        request,
        status=201,
        data={"user": {"id": user.pk, "email": user.email}},
    )


@require_http_methods(["POST"])
def api_login(request: HttpRequest) -> JsonResponse:
    payload, err = _parse_json_body(request)
    if err is not None:
        return err
    email = str(payload.get("email", ""))
    password = str(payload.get("password", ""))
    field_errors = []
    if not email.strip():
        field_errors.append({"field": "email", "message": "Email is required."})
    if not password:
        field_errors.append({"field": "password", "message": "Password is required."})
    if field_errors:
        return validation_error(request, field_errors)

    ip = _throttle.client_ip(request)
    allowed, retry_after = _throttle.check(email, ip)
    if not allowed:
        # 429 + Retry-After — the API and web surfaces share this contract.
        return error_response(
            request,
            status=429,
            code=ERR_THROTTLED,
            headers={"Retry-After": str(max(1, int(retry_after)))},
        )
    user, error_code = _attempt_login(email, password)
    if user is None:
        _throttle.record_failure(email, ip)
        return error_response(request, status=401, code=error_code)
    _throttle.record_success(email, ip)
    django_login(request, user)
    return success_response(
        request,
        data={"user": {"id": user.pk, "email": user.email}},
    )


@require_http_methods(["POST"])
def api_logout(request: HttpRequest) -> JsonResponse:
    if not request.user.is_authenticated:
        return error_response(request, status=401, code=ERR_UNAUTHENTICATED)
    django_logout(request)
    return success_response(request, data={"loggedOut": True})


@api_login_required
@require_GET
def api_me(request: HttpRequest) -> JsonResponse:
    user = request.user
    return success_response(
        request,
        data={"user": {"id": user.pk, "email": user.email, "dateJoined": user.date_joined.isoformat()}},
    )


@api_login_required
@require_GET
def api_home(request: HttpRequest) -> JsonResponse:
    notes = request.user.notes.all()
    return success_response(
        request,
        data={
            "user": {"id": request.user.pk, "email": request.user.email},
            "metrics": {
                "noteCount": notes.count(),
                "algorithmCount": len(algorithms.catalog()),
            },
            "notes": [note.to_dict() for note in notes],
        },
    )


@api_login_required
@require_http_methods(["GET", "POST"])
def api_notes(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return success_response(
            request, data={"notes": [n.to_dict() for n in request.user.notes.all()]}
        )
    payload, err = _parse_json_body(request)
    if err is not None:
        return err
    form = NoteForm(payload)
    if not form.is_valid():
        return validation_error(request, _form_error_details(form))
    note = Note.objects.create(
        owner=request.user,
        title=form.cleaned_data["title"],
        body=form.cleaned_data["body"],
    )
    return success_response(request, status=201, data={"note": note.to_dict()})


@api_login_required
@require_http_methods(["GET", "PATCH", "DELETE"])
def api_note_detail(request: HttpRequest, note_id: int) -> JsonResponse:
    note = request.user.notes.filter(pk=note_id).first()
    if note is None:
        # Owner-scoped lookup: other users' notes look like a 404, not a 403.
        return error_response(request, status=404, code=ERR_NOT_FOUND)
    if request.method == "GET":
        return success_response(request, data={"note": note.to_dict()})
    if request.method == "DELETE":
        note.delete()
        return success_response(request, data={"deleted": True, "id": note_id})
    payload, err = _parse_json_body(request)
    if err is not None:
        return err
    form = NoteForm(payload)
    if not form.is_valid():
        return validation_error(request, _form_error_details(form))
    note.title = form.cleaned_data["title"]
    note.body = form.cleaned_data["body"]
    note.save(update_fields=["title", "body", "updated_at"])
    return success_response(request, data={"note": note.to_dict()})


@api_login_required
@require_GET
def api_algorithm_catalog(request: HttpRequest) -> JsonResponse:
    return success_response(request, data={"algorithms": algorithms.catalog()})


@api_login_required
@require_POST
def api_algorithm_run(request: HttpRequest) -> JsonResponse:
    payload, err = _parse_json_body(request)
    if err is not None:
        return err
    name = str(payload.get("algorithm", ""))
    raw_payload = payload.get("input", "")
    if not isinstance(raw_payload, str):
        return validation_error(
            request, [{"field": "input", "message": "Input must be a string."}]
        )
    if len(raw_payload) > settings.MAX_INPUT_CHARS:
        return error_response(request, status=413, code=ERR_INPUT_TOO_LARGE)
    if not name or not algorithms.known(name):
        return error_response(request, status=400, code=ERR_UNKNOWN_ALGORITHM)
    try:
        output, duration_ms, complexity = algorithms.run(name, raw_payload)
    except ValueError as exc:
        return validation_error(request, [{"field": "input", "message": str(exc)}])
    return success_response(
        request,
        data={
            "algorithm": name,
            "output": output,
            "durationMs": duration_ms,
            "complexity": complexity,
        },
    )
