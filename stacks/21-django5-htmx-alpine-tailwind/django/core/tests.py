"""Stack 21 Django test suite.

Covers (task contract): auth (register/login/logout revocation/cookies),
throttle (429 + Retry-After, per-identity, success clears), API envelope
shape + stable codes, htmx partial vs full response distinction, notes CRUD
(owner scoping, ORM), request-id validation, and the fixed algorithm catalog.
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from core import algorithms
from core.models import Note

User = get_user_model()

PASSWORD = "Correct-Horse-9x"


def envelope(response) -> dict:
    return json.loads(response.content)


class ThrottleResetMixin:
    """Clear the in-process throttle between tests (it is a module-level
    singleton; without this, failure tallies leak across test cases)."""

    def setUp(self):
        super().setUp()
        from core.views import _throttle

        _throttle._buckets.clear()


class AuthTests(ThrottleResetMixin, TestCase):
    def test_register_creates_user_and_logs_in(self):
        response = self.client.post(
            "/api/v1/register",
            data=json.dumps({"email": "a@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        payload = envelope(response)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["user"]["email"], "a@example.com")
        self.assertTrue(User.objects.filter(email="a@example.com").exists())
        # logged in: the session cookie is set and /api/v1/me works
        self.assertIn("stack21_session", response.cookies)
        me = self.client.get("/api/v1/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(envelope(me)["data"]["user"]["email"], "a@example.com")

    def test_register_rejects_invalid_email_and_weak_password(self):
        response = self.client.post(
            "/api/v1/register",
            data=json.dumps({"email": "not-an-email", "password": "short"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)
        payload = envelope(response)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "VALIDATION_ERROR")
        fields = {d["field"] for d in payload["error"]["details"]}
        self.assertIn("email", fields)
        self.assertIn("password", fields)
        self.assertEqual(User.objects.count(), 0)

    def test_duplicate_email_maps_to_email_taken(self):
        self.client.post(
            "/api/v1/register",
            data=json.dumps({"email": "dup@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        second = Client()
        response = second.post(
            "/api/v1/register",
            data=json.dumps({"email": "DUP@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(envelope(response)["error"]["code"], "EMAIL_TAKEN")
        # no exception leakage: data is null, message is the safe one
        self.assertIsNone(envelope(response)["data"])
        self.assertEqual(User.objects.count(), 1)

    def test_login_success_sets_httponly_session_cookie(self):
        User.objects.create_user(email="b@example.com", password=PASSWORD)
        response = self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "b@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        cookie = response.cookies["stack21_session"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")

    def test_login_wrong_password_401(self):
        User.objects.create_user(email="c@example.com", password=PASSWORD)
        response = self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "c@example.com", "password": "wrong-pass-1"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(envelope(response)["error"]["code"], "INVALID_CREDENTIALS")

    def test_login_unknown_email_parity_with_wrong_password(self):
        wrong = self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "known@example.com", "password": "nope-pass-99"}),
            content_type="application/json",
        )
        User.objects.create_user(email="known@example.com", password=PASSWORD)
        unknown = Client().post(
            "/api/v1/login",
            data=json.dumps({"email": "ghost@example.com", "password": "nope-pass-99"}),
            content_type="application/json",
        )
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(
            envelope(wrong)["error"]["code"], envelope(unknown)["error"]["code"]
        )
        self.assertEqual(
            envelope(wrong)["error"]["message"], envelope(unknown)["error"]["message"]
        )

    def test_logout_revokes_session_server_side(self):
        User.objects.create_user(email="d@example.com", password=PASSWORD)
        self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "d@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(self.client.get("/api/v1/me").status_code, 200)
        response = self.client.post("/api/v1/logout")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_protected_endpoints_reject_anonymous(self):
        for path in ("/api/v1/me", "/api/v1/home", "/api/v1/notes", "/api/v1/algorithm"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 401, path)
            self.assertEqual(envelope(response)["error"]["code"], "UNAUTHENTICATED")


class EnvelopeTests(ThrottleResetMixin, TestCase):
    def test_envelope_shape_success(self):
        response = self.client.get("/healthz")
        payload = envelope(response)
        self.assertEqual(
            set(payload.keys()), {"ok", "data", "error", "requestId"}
        )
        self.assertTrue(payload["ok"])
        self.assertIsNone(payload["error"])
        self.assertTrue(payload["requestId"])

    def test_envelope_shape_error(self):
        response = self.client.get("/api/v1/me")
        payload = envelope(response)
        self.assertEqual(
            set(payload.keys()), {"ok", "data", "error", "requestId"}
        )
        self.assertFalse(payload["ok"])
        self.assertIsNone(payload["data"])
        self.assertEqual(payload["error"]["code"], "UNAUTHENTICATED")

    def test_request_id_echoed_when_valid(self):
        response = self.client.get("/healthz", HTTP_X_REQUEST_ID="test-req-42")
        self.assertEqual(response["X-Request-Id"], "test-req-42")
        self.assertEqual(envelope(response)["requestId"], "test-req-42")

    def test_request_id_replaced_when_invalid(self):
        response = self.client.get("/healthz", HTTP_X_REQUEST_ID="bad id!!")
        self.assertRegex(response["X-Request-Id"], r"^[0-9a-f]{32}$")

    def test_request_id_replaced_when_too_long(self):
        response = self.client.get("/healthz", HTTP_X_REQUEST_ID="x" * 65)
        self.assertRegex(response["X-Request-Id"], r"^[0-9a-f]{32}$")

    def test_oversized_body_413(self):
        User.objects.create_user(email="e@example.com", password=PASSWORD)
        self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "e@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        response = self.client.post(
            "/api/v1/notes",
            data=json.dumps({"title": "t", "body": "x" * 300_000}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(envelope(response)["error"]["code"], "PAYLOAD_TOO_LARGE")


class ThrottleTests(ThrottleResetMixin, TestCase):
    def _fail_login(self, client: Client, email: str):
        return client.post(
            "/api/v1/login",
            data=json.dumps({"email": email, "password": "IncorrectHorse1"}),
            content_type="application/json",
        )

    def test_five_failures_then_429_with_retry_after(self):
        for _ in range(5):
            response = self._fail_login(self.client, "thr@example.com")
            self.assertEqual(response.status_code, 401)
        response = self._fail_login(self.client, "thr@example.com")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(envelope(response)["error"]["code"], "THROTTLED")
        self.assertIn("Retry-After", response)
        self.assertGreaterEqual(int(response["Retry-After"]), 1)

    def test_correct_login_from_throttled_identity_stays_429(self):
        User.objects.create_user(email="thr2@example.com", password=PASSWORD)
        fresh = Client()
        for _ in range(5):
            self._fail_login(fresh, "thr2@example.com")
        response = fresh.post(
            "/api/v1/login",
            data=json.dumps({"email": "thr2@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)

    def test_success_clears_tally(self):
        User.objects.create_user(email="thr3@example.com", password=PASSWORD)
        for _ in range(4):
            self._fail_login(self.client, "thr3@example.com")
        ok = self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "thr3@example.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(ok.status_code, 200)
        # tally cleared: the next 5 failures are 401 again, the 6th is throttled
        for _ in range(5):
            self.assertEqual(self._fail_login(self.client, "thr3@example.com").status_code, 401)
        self.assertEqual(self._fail_login(self.client, "thr3@example.com").status_code, 429)

    def test_varying_spoofed_xff_does_not_reset_counter(self):
        # TRUSTED_PROXIES defaults empty: XFF must be ignored entirely.
        for i in range(5):
            response = self.client.post(
                "/api/v1/login",
                data=json.dumps({"email": "xff@example.com", "password": "IncorrectHorse1"}),
                content_type="application/json",
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}",
            )
            self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/api/v1/login",
            data=json.dumps({"email": "xff@example.com", "password": "IncorrectHorse1"}),
            content_type="application/json",
            HTTP_X_FORWARDED_FOR="10.9.9.9",
        )
        self.assertEqual(response.status_code, 429)

    def test_web_login_throttled_429_not_422(self):
        # The web path mirrors the API: 429 + Retry-After, form still rendered.
        # 5 failures answer 401; the 6th attempt is throttled with the form.
        User.objects.create_user(email="web@example.com", password=PASSWORD)
        for _ in range(5):
            response = self.client.post(
                "/login/", data={"email": "web@example.com", "password": "IncorrectHorse1"}
            )
            # failed web logins re-render the form with 422 (Stack-04 parity);
            # only the throttle answers 429
            self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/login/", data={"email": "web@example.com", "password": "IncorrectHorse1"}
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.assertContains(response, "Too many attempts", status_code=429)

    def test_lockout_ends_after_window(self):
        # A block must never outlive its window: once the window has passed,
        # the identity is allowed again (401 for a wrong password, not 429).
        from types import SimpleNamespace
        from unittest import mock

        from core import throttle as throttle_module

        clock = {"now": 1000.0}
        fake_time = SimpleNamespace(monotonic=lambda: clock["now"])
        with mock.patch.object(throttle_module, "time", fake_time):
            for _ in range(5):
                self._fail_login(self.client, "exp@example.com")
            self.assertEqual(self._fail_login(self.client, "exp@example.com").status_code, 429)
            # Still inside the block window (blocked_until = start + 60).
            clock["now"] += 30
            self.assertEqual(self._fail_login(self.client, "exp@example.com").status_code, 429)
            # Past the window: bucket reset, throttling no longer applies.
            clock["now"] += 31
            response = self._fail_login(self.client, "exp@example.com")
            self.assertEqual(response.status_code, 401)
            self.assertEqual(envelope(response)["error"]["code"], "INVALID_CREDENTIALS")

    def test_expired_buckets_are_pruned(self):
        # Distinct identities must not accumulate forever: a failure recorded
        # after the window sweeps expired buckets (bounded memory).
        from types import SimpleNamespace
        from unittest import mock

        from core import throttle as throttle_module
        from core.throttle import LoginThrottle

        clock = {"now": 2000.0}
        fake_time = SimpleNamespace(monotonic=lambda: clock["now"])
        throttle = LoginThrottle(limit=2, window_seconds=60)
        with mock.patch.object(throttle_module, "time", fake_time):
            for _ in range(2):
                throttle.record_failure("prune@example.com", "9.9.9.9")
            self.assertEqual(len(throttle._buckets), 1)
            # Well past the window (and its block): this record_failure
            # triggers the opportunistic prune sweep.
            clock["now"] += 61
            throttle.record_failure("fresh@example.com", "9.9.9.8")
        self.assertEqual(
            list(throttle._buckets),
            [LoginThrottle.key("fresh@example.com", "9.9.9.8")],
        )


class HtmxTests(ThrottleResetMixin, TestCase):
    def setUp(self):
        super().setUp()  # ThrottleResetMixin: clear in-process throttle buckets
        self.user = User.objects.create_user(email="hx@example.com", password=PASSWORD)

    def _login(self):
        # force_login: same rationale as NoteCrudTests.setUp; the real web and
        # API login flows are exercised in AuthTests/ThrottleTests.
        self.client.force_login(self.user)

    def test_register_htmx_failure_returns_fragment_not_full_page(self):
        response = self.client.post(
            "/register/",
            data={"email": "bad", "password": "short"},
            HTTP_HX_REQUEST="true",
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotContains(response, "<html", status_code=422)
        self.assertContains(response, 'id="register-form"', status_code=422)

    def test_register_full_page_failure_renders_document(self):
        response = self.client.post(
            "/register/", data={"email": "bad", "password": "short"}
        )
        self.assertEqual(response.status_code, 422)
        self.assertContains(response, "<html", status_code=422)

    def test_login_htmx_success_204_with_hx_redirect(self):
        # Fresh client logs in through the web form via htmx (real flow).
        fresh = Client()
        response = fresh.post(
            "/login/",
            data={"email": "hx@example.com", "password": PASSWORD},
            HTTP_HX_REQUEST="true",
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response["HX-Redirect"], "/home/")

    def test_login_non_htmx_success_redirects(self):
        response = self.client.post(
            "/login/", data={"email": "hx@example.com", "password": PASSWORD}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/home/")

    def test_htmx_protected_page_401_with_hx_redirect_when_anonymous(self):
        response = self.client.get("/home/", HTTP_HX_REQUEST="true")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["HX-Redirect"], "/login/")

    def test_full_page_protected_redirects_to_login(self):
        response = self.client.get("/home/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith("/login/"))

    def test_algorithm_run_htmx_swaps_result_fragment(self):
        self._login()
        response = self.client.post(
            "/algorithm/",
            data={"algorithm": "fizzbuzz", "payload": "5"},
            HTTP_HX_REQUEST="true",
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "<html")
        self.assertContains(response, "Measured duration")
        self.assertContains(response, "Theoretical complexity")

    def test_algorithm_run_shows_duration_and_complexity_separately(self):
        self._login()
        response = self.client.post(
            "/algorithm/", data={"algorithm": "fizzbuzz", "payload": "5"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Measured duration")
        self.assertContains(response, "Theoretical complexity")

    def test_htmx_config_meta_declares_4xx_swapping(self):
        # Stack-04 lesson: htmx 2 does not swap 4xx bodies unless configured.
        response = self.client.get("/login/")
        self.assertContains(response, 'name="htmx-config"')
        self.assertContains(response, '"422","swap":true')
        self.assertContains(response, '"429","swap":true')


class NoteCrudTests(ThrottleResetMixin, TestCase):
    """CRUD and owner-scoping tests.

    setUp uses ``force_login`` (the Django-idiomatic shortcut): the real
    /api/v1/login flow — cookie flags, enumeration parity, throttle — is
    covered end-to-end in AuthTests/ThrottleTests; these tests only need an
    authenticated client, and the login-view-created session row does not
    survive TestCase's per-test transaction bookkeeping across tests
    (SESSION_SAVE_EVERY_REQUEST + savepoint teardown quirk).
    """

    def setUp(self):
        super().setUp()  # ThrottleResetMixin: clear in-process throttle buckets
        self.user = User.objects.create_user(email="owner@example.com", password=PASSWORD)
        self.other = User.objects.create_user(email="intruder@example.com", password=PASSWORD)
        self.client.force_login(self.user)

    def test_note_crud_roundtrip(self):
        created = self.client.post(
            "/api/v1/notes",
            data=json.dumps({"title": "T1", "body": "B1"}),
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        note_id = envelope(created)["data"]["note"]["id"]

        listed = self.client.get("/api/v1/notes")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(envelope(listed)["data"]["notes"]), 1)

        updated = self.client.patch(
            f"/api/v1/notes/{note_id}",
            data=json.dumps({"title": "T2", "body": "B2"}),
            content_type="application/json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(envelope(updated)["data"]["note"]["title"], "T2")

        deleted = self.client.delete(f"/api/v1/notes/{note_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(envelope(deleted)["data"]["deleted"])
        self.assertEqual(Note.objects.count(), 0)

    def test_note_validation_422(self):
        response = self.client.post(
            "/api/v1/notes", data=json.dumps({"title": ""}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(envelope(response)["error"]["code"], "VALIDATION_ERROR")

    def test_owner_scoping_hides_other_users_notes(self):
        note = Note.objects.create(owner=self.other, title="secret")
        response = self.client.get(f"/api/v1/notes/{note.pk}")
        self.assertEqual(response.status_code, 404)
        response = self.client.delete(f"/api/v1/notes/{note.pk}")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Note.objects.filter(pk=note.pk).exists())

    def test_orm_query_owner_scoped(self):
        Note.objects.create(owner=self.user, title="mine")
        Note.objects.create(owner=self.other, title="theirs")
        self.assertEqual(list(self.user.notes.values_list("title", flat=True)), ["mine"])


class AlgorithmTests(ThrottleResetMixin, TestCase):
    def test_catalog_is_fixed_and_safe(self):
        names = {a["name"] for a in algorithms.catalog()}
        self.assertEqual(names, {"fizzbuzz", "palindrome", "fibonacci", "reverse", "wordcount"})

    def test_fizzbuzz_output(self):
        output, duration, complexity = algorithms.run("fizzbuzz", "5")
        self.assertEqual(output.splitlines(), ["1", "2", "Fizz", "4", "Buzz"])
        self.assertEqual(complexity, "O(n)")
        self.assertIsInstance(duration, int)

    def test_palindrome(self):
        output, _, _ = algorithms.run("palindrome", "Never odd or even")
        self.assertEqual(output, "true")

    def test_fibonacci_bounded(self):
        with self.assertRaises(ValueError):
            algorithms.run("fibonacci", "91")
        output, _, _ = algorithms.run("fibonacci", "10")
        self.assertTrue(output.startswith("0, 1, 1, 2"))

    def test_unknown_algorithm_rejected(self):
        self.assertFalse(algorithms.known("eval-user-code"))

    def test_oversized_input_rejected_by_view(self):
        user = User.objects.create_user(email="alg@example.com", password=PASSWORD)
        self.client.force_login(user)
        response = self.client.post(
            "/api/v1/algorithm/run",
            data=json.dumps({"algorithm": "reverse", "input": "x" * 10001}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(envelope(response)["error"]["code"], "INPUT_TOO_LARGE")
        # boundary: 10,000 accepted
        ok = self.client.post(
            "/api/v1/algorithm/run",
            data=json.dumps({"algorithm": "reverse", "input": "x" * 10000}),
            content_type="application/json",
        )
        self.assertEqual(ok.status_code, 200)


class AdminTests(ThrottleResetMixin, TestCase):
    def test_admin_enabled_and_models_registered(self):
        from django.contrib import admin as django_admin

        self.assertIn("django.contrib.admin", __import__("django.conf", fromlist=["settings"]).settings.INSTALLED_APPS)
        self.assertTrue(django_admin.site.is_registered(Note))
        self.assertTrue(django_admin.site.is_registered(User))

    def test_admin_login_page_reachable(self):
        response = self.client.get("/admin/login/")
        self.assertEqual(response.status_code, 200)

    def test_staff_user_sees_note_admin(self):
        staff = User.objects.create_user(
            email="staff@example.com",
            password=PASSWORD,
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_login(staff)
        response = self.client.get("/admin/core/note/")
        self.assertEqual(response.status_code, 200)


class WebScreensTests(ThrottleResetMixin, TestCase):
    def test_all_four_screens_render(self):
        self.assertEqual(self.client.get("/register/").status_code, 200)
        self.assertEqual(self.client.get("/login/").status_code, 200)

        user = User.objects.create_user(email="screens@example.com", password=PASSWORD)
        self.client.force_login(user)
        self.assertEqual(self.client.get("/home/").status_code, 200)
        self.assertEqual(self.client.get("/algorithm/").status_code, 200)

    def test_home_shows_email_and_metrics(self):
        user = User.objects.create_user(email="homer@example.com", password=PASSWORD)
        self.client.force_login(user)
        response = self.client.get("/home/")
        self.assertContains(response, "homer@example.com")
        self.assertContains(response, "Notes")

    def test_register_page_has_accessible_labels(self):
        response = self.client.get("/register/")
        self.assertContains(response, "<label")
        self.assertContains(response, 'for="id_email"')
        self.assertContains(response, 'for="id_password"')

    def test_static_assets_exist_on_disk(self):
        # Static files are served by the dev server / staticfiles in real
        # deployments; the test runner (DEBUG=False, no staticfiles handler)
        # returns 404 regardless, so assert the vendored/built assets exist
        # and are non-trivial. Live serving is covered by the HTTP smoke.
        from django.conf import settings as s

        import pathlib

        base = pathlib.Path(s.BASE_DIR)
        htmx = base / "static" / "js" / "htmx.min.js"
        alpine = base / "static" / "js" / "alpine.min.js"
        css = base / "static" / "css" / "tailwind.css"
        self.assertGreater(htmx.stat().st_size, 40_000)  # htmx 2 minified
        self.assertGreater(alpine.stat().st_size, 40_000)  # Alpine 3 cdn build
        self.assertGreater(css.stat().st_size, 2_000)  # built Tailwind output
        self.assertIn("htmx", htmx.read_text(encoding="utf-8")[:100])

    def test_reverse_urls_resolve(self):
        self.assertEqual(reverse("core:login"), "/login/")
        self.assertEqual(reverse("core:api-notes"), "/api/v1/notes")
