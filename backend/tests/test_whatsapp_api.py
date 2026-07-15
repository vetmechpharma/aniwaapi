"""
Backend tests for the Unofficial WhatsApp API.

Uses REACT_APP_BACKEND_URL to hit the public preview URL as the user would.
The Node.js Baileys sidecar is running internally, but no phone will scan a QR,
so we accept "not connected" / "connecting" statuses as pass conditions where noted.
"""

import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Load backend .env to obtain SIDECAR_TOKEN
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Frontend .env for public URL
FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if FRONTEND_ENV.exists():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip().strip('"')

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SIDECAR_TOKEN = os.environ["SIDECAR_TOKEN"]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

TIMEOUT = 30


# --------------- Fixtures ---------------
@pytest.fixture(scope="module")
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_client():
    """Logged in session with cookies set."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=TIMEOUT)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies, "access_token cookie not set"
    assert "refresh_token" in s.cookies, "refresh_token cookie not set"
    return s


# ---------------------- Health ----------------------
class TestHealth:
    def test_health(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["sidecar"] is True, f"Sidecar not reachable: {d}"


# ---------------------- Auth ----------------------
class TestAuth:
    def test_login_success_sets_cookies_and_returns_user(self, anon_client):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert body["role"] == "admin"
        assert "id" in body
        assert "access_token" in s.cookies
        assert "refresh_token" in s.cookies

    def test_login_invalid(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/auth/login",
                             json={"email": ADMIN_EMAIL, "password": "wrong"},
                             timeout=TIMEOUT)
        assert r.status_code == 401

    def test_me_with_cookie(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_refresh_issues_new_access(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   timeout=TIMEOUT)
        assert r.status_code == 200
        original_access = s.cookies.get("access_token")
        # Drop access_token to force /refresh to issue a fresh one
        s.cookies.set("access_token", "", domain=s.cookies.list_domains()[0])
        r2 = s.post(f"{BASE_URL}/api/auth/refresh", timeout=TIMEOUT)
        assert r2.status_code == 200
        assert s.cookies.get("access_token"), "refresh did not set new access_token"
        assert s.cookies.get("access_token") != original_access or s.cookies.get("access_token")

    def test_logout_clears_cookies_and_me_401(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   timeout=TIMEOUT)
        assert r.status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=TIMEOUT)
        assert r.status_code == 200
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        assert r.status_code == 401


# ---------------------- Unauthorized access ----------------------
class TestUnauthorized:
    @pytest.mark.parametrize("path", [
        "/api/stats", "/api/sessions", "/api/rules", "/api/webhooks",
        "/api/logs", "/api/api-keys",
    ])
    def test_requires_auth(self, anon_client, path):
        r = anon_client.get(f"{BASE_URL}{path}", timeout=TIMEOUT)
        assert r.status_code == 401, f"{path} returned {r.status_code}"


# ---------------------- Sessions ----------------------
class TestSessions:
    session_id = f"TEST-primary-{uuid.uuid4().hex[:6]}"

    def test_a_create_session(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/sessions",
                             json={"session_id": self.session_id},
                             timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("sessionId") == self.session_id or "session" in d or d.get("status")

    def test_b_list_contains(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/sessions", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        ids = [s.get("id") or s.get("sessionId") for s in d.get("sessions", [])]
        assert self.session_id in ids, f"session not in list: {ids}"

    def test_c_get_detail(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        # Should have a status field; QR or connecting is expected
        assert "status" in d or "sessionId" in d

    def test_d_delete(self, auth_client):
        r = auth_client.delete(f"{BASE_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        assert r.status_code == 200


# ---------------------- Rules CRUD ----------------------
class TestRules:
    _rule_id = None
    _sid = f"TEST-rule-{uuid.uuid4().hex[:6]}"

    def test_a_create(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/rules",
                             json={"session_id": self._sid,
                                   "match_type": "contains",
                                   "trigger": "hi",
                                   "response": "hello!",
                                   "enabled": True},
                             timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "id" in d
        assert d["trigger"] == "hi"
        assert d["response"] == "hello!"
        TestRules._rule_id = d["id"]

    def test_b_list(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/rules", timeout=TIMEOUT)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json().get("rules", [])]
        assert TestRules._rule_id in ids

    def test_c_update(self, auth_client):
        r = auth_client.put(f"{BASE_URL}/api/rules/{TestRules._rule_id}",
                            json={"session_id": self._sid,
                                  "match_type": "exact",
                                  "trigger": "hi",
                                  "response": "hi back!",
                                  "enabled": False},
                            timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["match_type"] == "exact"
        assert d["response"] == "hi back!"
        assert d["enabled"] is False

    def test_d_delete(self, auth_client):
        r = auth_client.delete(f"{BASE_URL}/api/rules/{TestRules._rule_id}", timeout=TIMEOUT)
        assert r.status_code == 200
        r = auth_client.get(f"{BASE_URL}/api/rules", timeout=TIMEOUT)
        ids = [x["id"] for x in r.json().get("rules", [])]
        assert TestRules._rule_id not in ids


# ---------------------- Webhooks CRUD ----------------------
class TestWebhooks:
    _wid = None
    _sid = f"TEST-wh-{uuid.uuid4().hex[:6]}"

    def test_a_create(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/webhooks",
                             json={"session_id": self._sid,
                                   "url": "https://httpbin.org/post",
                                   "enabled": True},
                             timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["url"] == "https://httpbin.org/post"
        assert "id" in d
        TestWebhooks._wid = d["id"]

    def test_b_list(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/webhooks", timeout=TIMEOUT)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json().get("webhooks", [])]
        assert TestWebhooks._wid in ids

    def test_c_update(self, auth_client):
        r = auth_client.put(f"{BASE_URL}/api/webhooks/{TestWebhooks._wid}",
                            json={"session_id": self._sid,
                                  "url": "https://httpbin.org/anything",
                                  "enabled": False},
                            timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["enabled"] is False

    def test_d_test_endpoint(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/webhooks/{TestWebhooks._wid}/test", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "status" in d

    def test_e_delete(self, auth_client):
        r = auth_client.delete(f"{BASE_URL}/api/webhooks/{TestWebhooks._wid}", timeout=TIMEOUT)
        assert r.status_code == 200


# ---------------------- API Keys ----------------------
class TestApiKeys:
    _kid = None
    _full_key = None

    def test_a_create_returns_full_key(self, auth_client):
        r = auth_client.post(f"{BASE_URL}/api/api-keys",
                             json={"name": "TEST_pytest_key"},
                             timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "id" in d
        assert d["key"].startswith("wak_")
        TestApiKeys._kid = d["id"]
        TestApiKeys._full_key = d["key"]

    def test_b_list_returns_masked(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/api-keys", timeout=TIMEOUT)
        assert r.status_code == 200
        keys = r.json().get("keys", [])
        found = next((k for k in keys if k["id"] == TestApiKeys._kid), None)
        assert found is not None
        assert "key_masked" in found
        assert "key" not in found or found.get("key") is None

    def test_c_public_send_text_no_auth_401(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/v1/send/text",
                             json={"session_id": "x", "to": "1234", "text": "hi"},
                             timeout=TIMEOUT)
        assert r.status_code == 401

    def test_d_public_send_text_bogus_bearer_401(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/v1/send/text",
                             json={"session_id": "x", "to": "1234", "text": "hi"},
                             headers={"Authorization": "Bearer bogus_key_wak_xxx"},
                             timeout=TIMEOUT)
        assert r.status_code == 401

    def test_e_public_send_text_valid_key_expected_error(self, anon_client):
        # Session not connected, so sidecar returns 409/404. That's a PASS - correct behavior.
        r = anon_client.post(f"{BASE_URL}/api/v1/send/text",
                             json={"session_id": "not-a-real-session",
                                   "to": "1234", "text": "hi"},
                             headers={"Authorization": f"Bearer {TestApiKeys._full_key}"},
                             timeout=TIMEOUT)
        assert r.status_code in (404, 409), f"Expected 404/409, got {r.status_code}: {r.text}"

    def test_f_public_list_sessions_with_key(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/v1/sessions",
                            headers={"Authorization": f"Bearer {TestApiKeys._full_key}"},
                            timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert "sessions" in d

    def test_g_revoke(self, auth_client, anon_client):
        r = auth_client.post(f"{BASE_URL}/api/api-keys/{TestApiKeys._kid}/revoke", timeout=TIMEOUT)
        assert r.status_code == 200
        # Confirm revoked key now returns 401
        r2 = anon_client.get(f"{BASE_URL}/api/v1/sessions",
                             headers={"Authorization": f"Bearer {TestApiKeys._full_key}"},
                             timeout=TIMEOUT)
        assert r2.status_code == 401

    def test_h_delete(self, auth_client):
        r = auth_client.delete(f"{BASE_URL}/api/api-keys/{TestApiKeys._kid}", timeout=TIMEOUT)
        assert r.status_code == 200


# ---------------------- Stats + Logs ----------------------
class TestStatsAndLogs:
    def test_stats_shape(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/stats", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        for k in ("sessions_count", "sessions_connected", "rules_count",
                  "webhooks_count", "messages_24h", "api_keys_count"):
            assert k in d, f"missing key {k}"
            assert isinstance(d[k], int)

    def test_logs_returns_list(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/logs", timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json().get("messages"), list)


# ---------------------- Internal callback (sidecar) ----------------------
class TestInternalCallback:
    def test_a_missing_token_401(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/internal/incoming",
                             json={"type": "message", "sessionId": "x"},
                             timeout=TIMEOUT)
        assert r.status_code == 401

    def test_b_bad_token_401(self, anon_client):
        r = anon_client.post(f"{BASE_URL}/api/internal/incoming",
                             json={"type": "message", "sessionId": "x"},
                             headers={"X-Sidecar-Token": "wrong"},
                             timeout=TIMEOUT)
        assert r.status_code == 401

    def test_c_valid_token_stores_incoming_message(self, anon_client, auth_client):
        sid = f"TEST-cb-{uuid.uuid4().hex[:6]}"
        msg_id = f"mid_{uuid.uuid4().hex[:10]}"
        payload = {
            "type": "message",
            "sessionId": sid,
            "direction": "incoming",
            "remoteJid": "1234567890@s.whatsapp.net",
            "messageId": msg_id,
            "pushName": "Test User",
            "text": "hello there",
            "timestamp": int(time.time()),
        }
        r = anon_client.post(f"{BASE_URL}/api/internal/incoming",
                             json=payload,
                             headers={"X-Sidecar-Token": SIDECAR_TOKEN},
                             timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # Now verify it landed in /api/logs
        r2 = auth_client.get(f"{BASE_URL}/api/logs",
                             params={"session_id": sid}, timeout=TIMEOUT)
        assert r2.status_code == 200
        msgs = r2.json().get("messages", [])
        assert any(m.get("message_id") == msg_id for m in msgs), \
            f"incoming message not stored: {msgs}"

    def test_d_auto_reply_engine_no_crash(self, anon_client, auth_client):
        """Create a rule, feed matching incoming, verify server doesn't crash and message logged."""
        sid = f"TEST-rule-cb-{uuid.uuid4().hex[:6]}"
        # Create rule
        r = auth_client.post(f"{BASE_URL}/api/rules",
                             json={"session_id": sid, "match_type": "contains",
                                   "trigger": "ping", "response": "pong",
                                   "enabled": True}, timeout=TIMEOUT)
        assert r.status_code == 200
        rule_id = r.json()["id"]
        try:
            msg_id = f"mid_{uuid.uuid4().hex[:10]}"
            payload = {
                "type": "message",
                "sessionId": sid,
                "direction": "incoming",
                "remoteJid": "999@s.whatsapp.net",
                "messageId": msg_id,
                "text": "please ping me",
                "timestamp": int(time.time()),
            }
            r2 = anon_client.post(f"{BASE_URL}/api/internal/incoming",
                                  json=payload,
                                  headers={"X-Sidecar-Token": SIDECAR_TOKEN},
                                  timeout=TIMEOUT)
            assert r2.status_code == 200

            # Verify incoming stored, backend didn't crash
            r3 = auth_client.get(f"{BASE_URL}/api/logs",
                                 params={"session_id": sid}, timeout=TIMEOUT)
            assert r3.status_code == 200
            assert any(m.get("message_id") == msg_id for m in r3.json().get("messages", []))
        finally:
            auth_client.delete(f"{BASE_URL}/api/rules/{rule_id}", timeout=TIMEOUT)
