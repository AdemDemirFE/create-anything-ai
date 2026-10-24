"""Stack 21 live smoke test — real HTTP against a running runserver.

Usage: python smoke.py http://127.0.0.1:8321
Covers: register, login, session cookie flags, me/home, notes CRUD,
logout revocation, throttle 429 + Retry-After, htmx partial vs full page,
X-Request-Id echo/validation, envelope shape, oversized input.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8321"

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASS.append(name)
        print(f"  PASS {name}")
    else:
        FAIL.append(name)
        print(f"  FAIL {name} {detail}")


class Client:
    """Cookie-holding HTTP client with a per-instance cookie jar."""

    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        headers: dict | None = None,
        form: dict | None = None,
    ):
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            content_type = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode() if body is not None else None
            content_type = "application/json"
        request = urllib.request.Request(BASE + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", content_type)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as exc:
            response = exc
        raw = response.read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        return response, text

    def csrf_cookie(self) -> str:
        """Fetch a page to obtain the csrftoken cookie, then return it."""
        self.request("GET", "/login/")
        return next((c.value for c in self.jar if c.name == "csrftoken"), "")

    def csrf_api(self) -> str:
        _, text = self.request("GET", "/api/v1/csrf")
        return json.loads(text)["data"]["csrfToken"]


def envelope_ok(text: str, request_id: str | None = None) -> bool:
    try:
        payload = json.loads(text)
    except ValueError:
        return False
    if not isinstance(payload, dict) or set(payload) != {"ok", "data", "error", "requestId"}:
        return False
    if request_id is not None and payload.get("requestId") != request_id:
        return False
    return True


def main() -> int:
    print(f"smoke against {BASE}")

    client = Client()
    anon = Client()

    # --- healthz -------------------------------------------------------------
    response, text = client.request("GET", "/healthz")
    check("healthz 200 + envelope", response.status == 200 and envelope_ok(text))

    # --- X-Request-Id echo + validation ---------------------------------------
    response, text = client.request("GET", "/healthz", headers={"X-Request-Id": "smoke-echo-1"})
    check(
        "X-Request-Id echoed",
        response.headers.get("X-Request-Id") == "smoke-echo-1"
        and envelope_ok(text, "smoke-echo-1"),
    )
    response, text = client.request("GET", "/healthz", headers={"X-Request-Id": "bad id!@@"})
    check(
        "invalid X-Request-Id replaced (opaque 32-hex)",
        envelope_ok(text)
        and re.fullmatch(r"[0-9a-f]{32}", response.headers.get("X-Request-Id", "")) is not None,
    )

    # --- register ---------------------------------------------------------------
    response, text = client.request(
        "POST",
        "/api/v1/register",
        {"email": "smoke1@example.com", "password": "Correct-Horse-9x"},
        headers={"X-CSRFToken": client.csrf_api()},
    )
    check("register 201 + envelope", response.status == 201 and envelope_ok(text))
    check(
        "register sets HttpOnly session cookie",
        all(
            c.has_nonstandard_attr("HttpOnly")
            for c in client.jar
            if c.name == "stack21_session"
        ),
    )

    # duplicate email -> 422 EMAIL_TAKEN (parity: no account-existence oracle)
    dup = Client()
    _, dup_text = dup.request(
        "POST",
        "/api/v1/register",
        {"email": "smoke1@example.com", "password": "Correct-Horse-9x"},
        headers={"X-CSRFToken": dup.csrf_api()},
    )
    try:
        dup_payload = json.loads(dup_text)
        check(
            "duplicate email -> 422 EMAIL_TAKEN",
            dup_payload["error"]["code"] == "EMAIL_TAKEN",
        )
    except Exception:
        check("duplicate email -> 422 EMAIL_TAKEN", False, dup_text[:120])

    # invalid email / weak password -> 422 VALIDATION_ERROR with field details
    _, weak_text = anon.request(
        "POST",
        "/api/v1/register",
        {"email": "not-an-email", "password": "short"},
        headers={"X-CSRFToken": anon.csrf_api()},
    )
    try:
        weak = json.loads(weak_text)
        check(
            "register validation -> 422 + field details",
            weak["error"]["code"] == "VALIDATION_ERROR"
            and any(
                d["field"] in {"email", "password"}
                for d in weak["error"].get("details", [])
            ),
        )
    except Exception:
        check("register validation -> 422 + field details", False, weak_text[:120])

    # --- login + cookie flags ------------------------------------------------------
    login_client = Client()
    response, text = login_client.request(
        "POST",
        "/api/v1/login",
        {"email": "smoke1@example.com", "password": "Correct-Horse-9x"},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check("login 200 + envelope", response.status == 200 and envelope_ok(text))
    cookie = next((c for c in login_client.jar if c.name == "stack21_session"), None)
    check(
        "login sets HttpOnly session cookie",
        cookie is not None and cookie.has_nonstandard_attr("HttpOnly"),
    )

    # wrong password -> 401 INVALID_CREDENTIALS (same shape as unknown email)
    wrong = Client()
    _, wrong_text = wrong.request(
        "POST",
        "/api/v1/login",
        {"email": "smoke1@example.com", "password": "IncorrectHorse1"},
        headers={"X-CSRFToken": wrong.csrf_api()},
    )
    try:
        wrong_payload = json.loads(wrong_text)
        check(
            "wrong password 401 INVALID_CREDENTIALS",
            wrong_payload["error"]["code"] == "INVALID_CREDENTIALS",
        )
    except Exception:
        check("wrong password 401 INVALID_CREDENTIALS", False, wrong_text[:120])

    unknown = Client()
    _, unknown_text = unknown.request(
        "POST",
        "/api/v1/login",
        {"email": "ghost@example.com", "password": "whatever123"},
        headers={"X-CSRFToken": unknown.csrf_api()},
    )
    try:
        unknown_payload = json.loads(unknown_text)
        check(
            "unknown email same code+message as wrong password",
            unknown_payload["error"]["code"] == "INVALID_CREDENTIALS"
            and unknown_payload["error"]["message"] == wrong_payload["error"]["message"],
        )
    except Exception:
        check(
            "unknown email same code+message as wrong password",
            False,
            unknown_text[:120],
        )

    # --- protected endpoints ----------------------------------------------------
    response, text = login_client.request("GET", "/api/v1/me")
    check("me 200", response.status == 200 and envelope_ok(text))
    response, text = login_client.request("GET", "/api/v1/home")
    try:
        check(
            "home 200 + metrics",
            response.status == 200
            and json.loads(text)["data"]["metrics"]["algorithmCount"] >= 5,
        )
    except Exception:
        check("home 200 + metrics", False, text[:120])
    response, text = anon.request("GET", "/api/v1/me")
    check(
        "me anonymous 401",
        response.status == 401
        and json.loads(text)["error"]["code"] == "UNAUTHENTICATED",
    )

    # --- notes CRUD -----------------------------------------------------------
    response, text = login_client.request(
        "POST",
        "/api/v1/notes",
        {"title": "Smoke note", "body": "first"},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check("note create 201", response.status == 201 and envelope_ok(text))
    note_id = json.loads(text)["data"]["note"]["id"]
    response, text = login_client.request("GET", "/api/v1/notes")
    check(
        "note list 200",
        response.status == 200
        and any(n["id"] == note_id for n in json.loads(text)["data"]["notes"]),
    )
    response, text = login_client.request(
        "PATCH",
        f"/api/v1/notes/{note_id}",
        {"title": "Smoke note v2", "body": "edited"},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check(
        "note patch 200",
        response.status == 200
        and json.loads(text)["data"]["note"]["title"] == "Smoke note v2",
    )
    response, text = login_client.request("GET", f"/api/v1/notes/{note_id}")
    check("note get 200", response.status == 200)
    other = Client()
    other.request(
        "POST",
        "/api/v1/register",
        {"email": "other@example.com", "password": "Correct-Horse-9x"},
        headers={"X-CSRFToken": other.csrf_api()},
    )
    response, text = other.request("GET", f"/api/v1/notes/{note_id}")
    check(
        "other user's note -> 404 (owner-scoped)",
        response.status == 404 and json.loads(text)["error"]["code"] == "NOT_FOUND",
    )
    response, text = login_client.request(
        "DELETE",
        f"/api/v1/notes/{note_id}",
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check(
        "note delete 200",
        response.status == 200 and json.loads(text)["data"]["deleted"] is True,
    )

    # --- algorithm workbench -----------------------------------------------------
    response, text = login_client.request("GET", "/api/v1/algorithm")
    check(
        "algorithm catalog 200",
        response.status == 200 and len(json.loads(text)["data"]["algorithms"]) >= 5,
    )
    response, text = login_client.request(
        "POST",
        "/api/v1/algorithm/run",
        {"algorithm": "fizzbuzz", "input": "15"},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    payload = json.loads(text)
    check(
        "algorithm run 200 + duration + complexity",
        response.status == 200
        and "durationMs" in payload["data"]
        and payload["data"]["complexity"] == "O(n)",
    )
    response, text = login_client.request(
        "POST",
        "/api/v1/algorithm/run",
        {"algorithm": "nope", "input": "1"},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check(
        "unknown algorithm 400",
        response.status == 400 and json.loads(text)["error"]["code"] == "UNKNOWN_ALGORITHM",
    )
    response, text = login_client.request(
        "POST",
        "/api/v1/algorithm/run",
        {"algorithm": "reverse", "input": "x" * 10001},
        headers={"X-CSRFToken": login_client.csrf_api()},
    )
    check(
        "oversized input 413 INPUT_TOO_LARGE",
        response.status == 413 and json.loads(text)["error"]["code"] == "INPUT_TOO_LARGE",
    )
    response, text = anon.request(
        "POST",
        "/api/v1/algorithm/run",
        {"algorithm": "reverse", "input": "hi"},
        headers={"X-CSRFToken": anon.csrf_api()},
    )
    check("algorithm run anonymous 401", response.status == 401)

    # --- logout revocation ---------------------------------------------------------
    response, text = login_client.request(
        "POST", "/api/v1/logout", headers={"X-CSRFToken": login_client.csrf_api()}
    )
    check("logout 200", response.status == 200 and envelope_ok(text))
    response, text = login_client.request("GET", "/api/v1/me")
    check(
        "me after logout 401 (session revoked server-side)",
        response.status == 401,
    )

    # --- throttle: 5 failed logins answer 401, the 6th is 429 + Retry-After -----
    thr2 = Client()
    codes = []
    for _ in range(6):
        response, _ = thr2.request(
            "POST",
            "/api/v1/login",
            {"email": "throttle2@example.com", "password": "IncorrectHorse3"},
            headers={"X-CSRFToken": thr2.csrf_api()},
        )
        codes.append(response.status)
    check(
        "throttle: 5x401 then 429 with Retry-After header",
        codes[:5] == [401] * 5
        and codes[5] == 429
        and response.headers.get("Retry-After") is not None,
    )
    # A 6th failure keeps 429 and re-issues Retry-After.
    response, text = thr2.request(
        "POST",
        "/api/v1/login",
        {"email": "throttle2@example.com", "password": "IncorrectHorse3"},
        headers={"X-CSRFToken": thr2.csrf_api()},
    )
    check(
        "429 persists with Retry-After",
        response.status == 429 and response.headers.get("Retry-After") is not None,
    )

    # --- htmx: partial vs full page ------------------------------------------------
    hx = Client()
    csrf_value = hx.csrf_cookie()
    form = {"email": "smoke1@example.com", "password": "IncorrectHorse4"}

    def hx_post_login():
        request = urllib.request.Request(
            BASE + "/login/", data=urllib.parse.urlencode(form).encode(), method="POST"
        )
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        request.add_header("HX-Request", "true")
        request.add_header("X-CSRFToken", csrf_value)
        try:
            return hx.opener.open(request, timeout=10)
        except urllib.error.HTTPError as exc:
            return exc

    response = hx_post_login()
    text = response.read().decode("utf-8")
    check(
        "htmx failed login -> 422 partial fragment (no <html>)",
        response.status == 422 and 'id="login-form"' in text and "<html" not in text,
    )

    def full_post_login():
        request = urllib.request.Request(
            BASE + "/login/", data=urllib.parse.urlencode(form).encode(), method="POST"
        )
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        request.add_header("X-CSRFToken", csrf_value)
        try:
            return hx.opener.open(request, timeout=10)
        except urllib.error.HTTPError as exc:
            return exc

    response = full_post_login()
    text = response.read().decode("utf-8")
    check(
        "non-htmx failed login -> 422 full page",
        response.status == 422 and "<html" in text,
    )

    # web-path throttle walk: 4 more failures (1 already recorded) to reach 5,
    # then the next attempt is throttled 429 with the form still rendered
    for _ in range(4):
        response = hx_post_login()
    response = hx_post_login()
    text = response.read().decode("utf-8")
    check(
        "web throttled login -> 429 + Retry-After (form visible, not collapsed to 422)",
        response.status == 429
        and response.headers.get("Retry-After") is not None
        and 'id="login-form"' in text,
    )

    # --- summary -----------------------------------------------------------------
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", *FAIL, sep="\n  - ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
