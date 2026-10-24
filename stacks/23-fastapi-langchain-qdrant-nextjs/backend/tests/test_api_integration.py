"""Integration tests over TestClient: journeys + abuse cases (Stack 23).

Covers: register (201/validation/409), login (success/throttle-429/enum),
protected endpoints (401), logout/revocation, cookie flags.
Document/chat-specific cases live in test_documents_api.py / test_chat_api.py.
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
        assert client.get("/api/v1/me").status_code == 200

    def test_login_cookie_flags(self, client: TestClient) -> None:
        client.post("/api/v1/register", json={"email": "flags@b.co", "password": PASSWORD})
        res = client.post("/api/v1/login", json={"email": "flags@b.co", "password": PASSWORD})
        cookie = res.headers["set-cookie"]
        assert "STACK23_SESSION=" in cookie
        assert "HttpOnly" in cookie
        assert "samesite=lax" in cookie.lower()

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
        assert client.get("/api/v1/me").status_code == 401

    def test_documents_list_requires_auth_401(self, client: TestClient) -> None:
        assert client.get("/api/v1/documents").status_code == 401

    def test_documents_upload_requires_auth_401(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/documents",
            files={"file": ("a.txt", b"hello", "text/plain")},
        )
        assert res.status_code == 401

    def test_chat_requires_auth_401(self, client: TestClient) -> None:
        res = client.post("/api/v1/chat", json={"question": "hi"})
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHORIZED"

    def test_home_returns_profile_and_metrics_when_authed(
        self, auth_client: TestClient
    ) -> None:
        res = auth_client.get("/api/v1/home")
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
            cookies={"STACK23_SESSION": "f" * 64},
        )
        assert res.status_code == 401
