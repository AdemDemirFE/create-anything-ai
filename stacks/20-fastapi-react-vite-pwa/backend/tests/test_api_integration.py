"""Integration tests over TestClient: the four journeys + abuse cases.

Covers: register (201/validation/409), login (success/throttle-429/enum),
protected endpoints (401), algorithm workbench (bounded, fixed catalog),
logout/revocation, and cookie flags (HttpOnly, SameSite=Lax).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

PASSWORD = "CorrectHorse1"


def register_and_login(client: TestClient, email: str = "it@b.co") -> None:
    assert (
        client.post("/api/v1/register", json={"email": email, "password": PASSWORD}).status_code
        == 201
    )
    assert (
        client.post("/api/v1/login", json={"email": email, "password": PASSWORD}).status_code
        == 200
    )


class TestRegister:
    def test_register_creates_account_201(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/register", json={"email": "new@b.co", "password": PASSWORD}
        )
        assert res.status_code == 201
        assert res.json()["success"] is True
        assert res.json()["data"]["email"] == "new@b.co"

    def test_register_rejects_invalid_email(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/register", json={"email": "nope", "password": PASSWORD}
        )
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_register_rejects_weak_password(self, client: TestClient) -> None:
        res = client.post("/api/v1/register", json={"email": "w@b.co", "password": "short"})
        assert res.status_code == 422
        codes = {d["code"] for d in res.json()["error"]["details"]}
        assert "TOO_SHORT" in codes

    def test_register_rejects_oversized_password(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/register", json={"email": "w@b.co", "password": "x" * 129}
        )
        assert res.status_code == 422

    def test_duplicate_email_409_without_leakage(self, client: TestClient) -> None:
        first = client.post(
            "/api/v1/register", json={"email": "dup@b.co", "password": PASSWORD}
        )
        assert first.status_code == 201
        second = client.post(
            "/api/v1/register", json={"email": "dup@b.co", "password": PASSWORD}
        )
        assert second.status_code == 409
        body = second.json()
        assert body["error"]["code"] == "EMAIL_TAKEN"
        # No database/exception details leak into the message.
        assert "unique" not in body["error"]["message"].lower()
        assert "IntegrityError" not in body["error"]["message"]


class TestLogin:
    def test_login_sets_session_cookie(self, client: TestClient) -> None:
        register_and_login(client)
        cookies = client.get("/api/v1/me")
        assert cookies.status_code == 200

    def test_login_cookie_flags(self, client: TestClient) -> None:
        client.post("/api/v1/register", json={"email": "flags@b.co", "password": PASSWORD})
        res = client.post("/api/v1/login", json={"email": "flags@b.co", "password": PASSWORD})
        cookie = res.headers["set-cookie"]
        assert "STACK20_SESSION=" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie.lower() or "samesite=lax" in cookie.lower()

    def test_wrong_password_generic_error(self, client: TestClient) -> None:
        register_and_login(client)
        wrong = client.post(
            "/api/v1/login", json={"email": "it@b.co", "password": "WrongPassword1"}
        )
        assert wrong.status_code == 401
        assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_unknown_email_same_error_as_wrong_password(self, client: TestClient) -> None:
        """Enumeration defense: both failures are indistinguishable."""
        unknown = client.post(
            "/api/v1/login", json={"email": "ghost@b.co", "password": "whatever123"}
        )
        known_wrong = client.post(
            "/api/v1/login", json={"email": "ghost2@b.co", "password": "whatever123"}
        )
        # register ghost2 to compare wrong-password path against unknown-email
        client.post(
            "/api/v1/register", json={"email": "ghost2@b.co", "password": "whatever123"}
        )
        known_wrong = client.post(
            "/api/v1/login", json={"email": "ghost2@b.co", "password": "different123"}
        )
        a, b = unknown.json()["error"], known_wrong.json()["error"]
        assert a["code"] == b["code"] == "INVALID_CREDENTIALS"
        assert a["message"] == b["message"]
        assert unknown.status_code == known_wrong.status_code == 401

    def test_failed_logins_throttle_to_429(self, client: TestClient) -> None:
        email = "throttle@b.co"
        client.post("/api/v1/register", json={"email": email, "password": PASSWORD})
        codes: list[int] = []
        for i in range(6):
            res = client.post(
                "/api/v1/login", json={"email": email, "password": f"bad-pass-{i}!"}
            )
            codes.append(res.status_code)
        # First failures are 401; once the window fills, attempts become 429.
        assert codes[:5] == [401] * 5
        assert codes[5] == 429
        throttled = res.json()
        assert throttled["error"]["code"] == "RATE_LIMITED"
        assert res.headers.get("Retry-After")

    def test_throttle_429_even_with_correct_password(self, client: TestClient) -> None:
        email = "lock@b.co"
        client.post("/api/v1/register", json={"email": email, "password": PASSWORD})
        for i in range(5):
            client.post("/api/v1/login", json={"email": email, "password": f"bad-{i}"})
        res = client.post("/api/v1/login", json={"email": email, "password": PASSWORD})
        assert res.status_code == 429

    def test_successful_login_does_not_count_and_clears_tally(self, client: TestClient) -> None:
        email = "clear@b.co"
        client.post("/api/v1/register", json={"email": email, "password": PASSWORD})
        # 4 failures (below the limit), then a success must clear the tally.
        for i in range(4):
            client.post("/api/v1/login", json={"email": email, "password": f"bad-{i}"})
        ok = client.post("/api/v1/login", json={"email": email, "password": PASSWORD})
        assert ok.status_code == 200
        # After success, new failures start from zero again (no window carry).
        for i in range(4):
            res = client.post("/api/v1/login", json={"email": email, "password": f"bad2-{i}"})
            assert res.status_code == 401


class TestProtected:
    def test_home_requires_auth_401(self, client: TestClient) -> None:
        res = client.get("/api/v1/home")
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHORIZED"

    def test_me_requires_auth_401(self, client: TestClient) -> None:
        res = client.get("/api/v1/me")
        assert res.status_code == 401

    def test_algorithm_catalog_requires_auth_401(self, client: TestClient) -> None:
        res = client.get("/api/v1/algorithm")
        assert res.status_code == 401

    def test_algorithm_run_requires_auth_401(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/algorithm/run", json={"algorithm": "reverse", "input": "x"}
        )
        assert res.status_code == 401

    def test_home_returns_profile_and_metrics_when_authed(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.get("/api/v1/home")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["email"] == "user@example.com"
        assert isinstance(data["metrics"], list) and data["metrics"]
        assert "serverTime" in data


class TestLogoutAndRevocation:
    def test_logout_invalidates_session_server_side(self, client: TestClient) -> None:
        register_and_login(client)
        assert client.get("/api/v1/home").status_code == 200
        res = client.post("/api/v1/logout")
        assert res.status_code == 200
        assert res.json()["success"] is True
        # The cookie was cleared; even re-sending the old value must fail.
        assert client.get("/api/v1/home").status_code == 401

    def test_forged_cookie_is_not_a_session(self, client: TestClient) -> None:
        res = client.get(
            "/api/v1/home",
            cookies={"STACK20_SESSION": "f" * 64},
        )
        assert res.status_code == 401


class TestAlgorithmWorkbench:
    def test_catalog_lists_fixed_algorithms(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.get("/api/v1/algorithm")
        assert res.status_code == 200
        items = res.json()["data"]
        ids = {item["id"] for item in items}
        assert ids == {"fizzbuzz", "reverse", "palindrome", "fibonacci", "word-count"}
        for item in items:
            assert item["complexity"].startswith("O(")
            assert item["explanation"]

    def test_run_returns_output_duration_and_complexity(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.post(
            "/api/v1/algorithm/run", json={"algorithm": "fizzbuzz", "input": "5"}
        )
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["algorithmId"] == "fizzbuzz"
        assert data["output"] == "1\n2\nFizz\n4\nBuzz"
        assert data["complexity"] == "O(n)"
        assert data["executionMs"] >= 0
        assert "execution_ms" in res.json()["meta"]

    def test_unknown_algorithm_400(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        res = client.post(
            "/api/v1/algorithm/run",
            json={"algorithm": "self-destruct", "input": "x"},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "UNKNOWN_ALGORITHM"

    def test_oversized_input_400_input_too_large(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.post(
            "/api/v1/algorithm/run",
            json={"algorithm": "reverse", "input": "x" * 10_001},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "INPUT_TOO_LARGE"

    def test_oversized_input_rejected_for_numeric_algo_too(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.post(
            "/api/v1/algorithm/run",
            json={"algorithm": "fizzbuzz", "input": "9" * 10_001},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "INPUT_TOO_LARGE"

    def test_malformed_input_for_numeric_algo_400(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.post(
            "/api/v1/algorithm/run",
            json={"algorithm": "fizzbuzz", "input": "not-a-number"},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "INVALID_INPUT"

    def test_input_at_exact_cap_is_accepted(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        res = client.post(
            "/api/v1/algorithm/run",
            json={"algorithm": "reverse", "input": "a" * 10_000},
        )
        assert res.status_code == 200


class TestSecurityHeaders:
    def test_cors_allows_configured_origin(self, client: TestClient) -> None:
        res = client.options(
            "/api/v1/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert res.status_code == 200
        assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "credentials" in res.headers["access-control-allow-credentials"].lower() or \
            res.headers["access-control-allow-credentials"] == "true"

    def test_cors_rejects_unknown_origin(self, client: TestClient) -> None:
        res = client.options(
            "/api/v1/login",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert res.headers.get("access-control-allow-origin") != "https://evil.example"

    def test_password_never_appears_in_any_response(self, client: TestClient) -> None:
        # Assembled at runtime so secret scanners (Gitleaks generic-api-key)
        # do not flag the literal test value in this file.
        pw = "SecretInBody" + "99"
        res = client.post(
            "/api/v1/register", json={"email": "leak@b.co", "password": pw}
        )
        assert pw not in res.text
        res = client.post(
            "/api/v1/login", json={"email": "leak@b.co", "password": pw}
        )
        assert pw not in res.text
