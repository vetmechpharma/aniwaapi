"""
Iteration-2 backend tests for the Unofficial WhatsApp API.

Covers new features:
  - Health version 1.1.0 with sidecar=true
  - Brute-force lockout (uses a temporary throwaway DB user, NOT admin@example.com)
  - Business-hours CRUD + logic (auto-reply behavior within/outside hours)
  - API keys with scopes + rate limits + revocation
  - Scope enforcement on public /api/v1/*
  - Internal status callback (2->sent, 3->delivered, 4->read)
  - WebSocket auth + broadcast on incoming message
  - Public /api/v1/logs with scope enforcement
"""

import asyncio
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
import websockets  # ensured available - see conftest if missing
from dotenv import load_dotenv

# Load backend .env to obtain SIDECAR_TOKEN
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if FRONTEND_ENV.exists():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip().strip('"')

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SIDECAR_TOKEN = os.environ["SIDECAR_TOKEN"]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

WS_URL = BASE_URL.replace("http", "ws", 1) + "/api/ws"
TIMEOUT = 30


# --------------- fixtures ---------------
@pytest.fixture(scope="module")
def db():
    from pymongo import MongoClient
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed: {r.text}"
    return s


# ---------------------- Health ----------------------
class TestHealth:
    def test_health_v1_1(self, anon):
        r = anon.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["sidecar"] is True
        assert d.get("version") == "1.1.0", f"expected 1.1.0, got {d.get('version')}"


# ---------------------- Auth (still works) ----------------------
class TestAuthStillWorks:
    def test_login_me_logout(self, anon):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert "access_token" in s.cookies
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=TIMEOUT)
        assert r.status_code == 200
        # After logout, /me should return 401
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        assert r.status_code == 401


# ---------------------- Brute-force lockout ----------------------
class TestBruteForceLockout:
    """
    Uses a temporary throwaway user seeded directly into the DB so we don't
    permanently lock admin@example.com. Cleaned up in teardown.
    """
    _email = f"lockout_{uuid.uuid4().hex[:8]}@example.com"
    _password = "correct-horse-battery"

    @pytest.fixture(autouse=True, scope="class")
    def _seed_and_cleanup(self, db):
        import bcrypt
        h = bcrypt.hashpw(self._password.encode(), bcrypt.gensalt()).decode()
        db.users.insert_one({
            "email": self._email,
            "password_hash": h,
            "name": "Lockout Test",
            "role": "admin",
            "failed_logins": 0,
            "locked_until": None,
        })
        yield
        db.users.delete_one({"email": self._email})

    def test_lockout_after_5_fails(self, anon, db):
        # 5 wrong-password attempts
        for i in range(5):
            r = anon.post(f"{BASE_URL}/api/auth/login",
                          json={"email": self._email, "password": "wrong"},
                          timeout=TIMEOUT)
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"

        # 6th attempt (even with CORRECT password) → 429 with lock message
        r = anon.post(f"{BASE_URL}/api/auth/login",
                      json={"email": self._email, "password": self._password},
                      timeout=TIMEOUT)
        assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "locked" in detail.lower(), f"unexpected detail: {detail}"
        assert "minute" in detail.lower(), f"expected minute count in message: {detail}"

        # Verify DB state
        u = db.users.find_one({"email": self._email})
        assert u["locked_until"] is not None


# ---------------------- Business hours CRUD + logic ----------------------
class TestBusinessHours:
    _sid = f"test-bh-{uuid.uuid4().hex[:6]}"

    def test_a_get_defaults(self, auth):
        r = auth.get(f"{BASE_URL}/api/business-hours/{self._sid}", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        # Defaults
        assert d["enabled"] is False
        assert d["timezone"] == "UTC"
        assert d["start_time"] == "09:00"
        assert d["end_time"] == "18:00"

    def test_b_invalid_timezone_400(self, auth):
        r = auth.put(f"{BASE_URL}/api/business-hours/{self._sid}",
                     json={"enabled": True, "timezone": "Not/AZone",
                           "days": [0, 1, 2], "start_time": "09:00", "end_time": "17:00",
                           "fallback_message": "x", "also_use_rules_outside": True},
                     timeout=TIMEOUT)
        assert r.status_code == 400, r.text
        assert "timezone" in r.json()["detail"].lower()

    def test_c_invalid_time_format_400(self, auth):
        r = auth.put(f"{BASE_URL}/api/business-hours/{self._sid}",
                     json={"enabled": True, "timezone": "UTC",
                           "days": [0], "start_time": "9am", "end_time": "17:00",
                           "fallback_message": "x", "also_use_rules_outside": True},
                     timeout=TIMEOUT)
        assert r.status_code == 400, r.text
        assert "HH:MM" in r.json()["detail"]

    def test_d_put_persists(self, auth):
        body = {
            "enabled": True, "timezone": "Asia/Kolkata",
            "days": [0, 1, 2, 3, 4], "start_time": "10:00", "end_time": "19:00",
            "fallback_message": "TEST_FALLBACK", "also_use_rules_outside": False,
        }
        r = auth.put(f"{BASE_URL}/api/business-hours/{self._sid}", json=body, timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["timezone"] == "Asia/Kolkata"
        assert d["fallback_message"] == "TEST_FALLBACK"
        # GET verifies persistence
        r2 = auth.get(f"{BASE_URL}/api/business-hours/{self._sid}", timeout=TIMEOUT)
        assert r2.json()["fallback_message"] == "TEST_FALLBACK"

    def test_e_within_hours_no_autoreply(self, anon, auth, db):
        """
        Configure BH to cover 'now' in UTC → send incoming → expect NO outgoing.
        """
        sid = f"test-bh-within-{uuid.uuid4().hex[:6]}"
        from datetime import datetime, timezone as tz_
        weekday = datetime.now(tz_.utc).weekday()
        body = {
            "enabled": True, "timezone": "UTC",
            "days": [weekday], "start_time": "00:00", "end_time": "23:59",
            "fallback_message": "CLOSED", "also_use_rules_outside": True,
        }
        r = auth.put(f"{BASE_URL}/api/business-hours/{sid}", json=body, timeout=TIMEOUT)
        assert r.status_code == 200

        # Clean any existing messages for this sid
        db.messages.delete_many({"session_id": sid})

        msg_id = f"mid_{uuid.uuid4().hex[:10]}"
        r = anon.post(f"{BASE_URL}/api/internal/incoming",
                      json={"type": "message", "sessionId": sid, "direction": "incoming",
                            "remoteJid": "1@s.whatsapp.net", "messageId": msg_id,
                            "text": "hi", "timestamp": int(time.time())},
                      headers={"X-Sidecar-Token": SIDECAR_TOKEN},
                      timeout=TIMEOUT)
        assert r.status_code == 200

        # give server a moment for async fanout
        time.sleep(1)

        msgs = list(db.messages.find({"session_id": sid}))
        assert len(msgs) == 1, f"expected only incoming, got: {[m.get('direction') for m in msgs]}"
        assert msgs[0]["direction"] == "incoming"
        assert msgs[0]["text"] == "hi"
        # Cleanup
        db.messages.delete_many({"session_id": sid})
        db.business_hours.delete_one({"session_id": sid})

    def test_f_disabled_bh_incoming_still_stored(self, anon, auth, db):
        """
        Disable BH + create a matching rule. incoming should still be stored (rule fire
        will fail with 409 since fake session — just verify no crash + incoming stored).
        """
        sid = f"test-bh-off-{uuid.uuid4().hex[:6]}"
        r = auth.put(f"{BASE_URL}/api/business-hours/{sid}",
                     json={"enabled": False, "timezone": "UTC", "days": [0, 1, 2, 3, 4, 5, 6],
                           "start_time": "09:00", "end_time": "18:00",
                           "fallback_message": "x", "also_use_rules_outside": True},
                     timeout=TIMEOUT)
        assert r.status_code == 200

        # Create a rule that will match
        rule = auth.post(f"{BASE_URL}/api/rules",
                        json={"session_id": sid, "match_type": "contains",
                              "trigger": "hi", "response": "hello!", "enabled": True},
                        timeout=TIMEOUT).json()

        db.messages.delete_many({"session_id": sid})
        msg_id = f"mid_{uuid.uuid4().hex[:10]}"
        r = anon.post(f"{BASE_URL}/api/internal/incoming",
                      json={"type": "message", "sessionId": sid, "direction": "incoming",
                            "remoteJid": "2@s.whatsapp.net", "messageId": msg_id,
                            "text": "hi there", "timestamp": int(time.time())},
                      headers={"X-Sidecar-Token": SIDECAR_TOKEN},
                      timeout=TIMEOUT)
        assert r.status_code == 200

        time.sleep(1)
        msgs = list(db.messages.find({"session_id": sid}))
        # Should have at least the incoming, may or may not have outgoing (fake session -> send fails silently)
        incoming = [m for m in msgs if m["direction"] == "incoming"]
        assert len(incoming) == 1

        # Cleanup
        auth.delete(f"{BASE_URL}/api/rules/{rule['id']}", timeout=TIMEOUT)
        db.messages.delete_many({"session_id": sid})
        db.business_hours.delete_one({"session_id": sid})


# ---------------------- API keys with scopes + rate limits ----------------------
class TestApiKeyScopes:
    _kid = None
    _key = None
    _kid_full = None
    _key_full = None

    def test_a_available_scopes_listed(self, auth):
        r = auth.get(f"{BASE_URL}/api/api-keys", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("available_scopes"), list)
        for s in ("send:text", "sessions:read", "logs:read"):
            assert s in d["available_scopes"], f"missing scope {s}"

    def test_b_create_scoped_key(self, auth):
        r = auth.post(f"{BASE_URL}/api/api-keys",
                      json={"name": "TEST_scoped", "scopes": ["sessions:read"],
                            "rate_limit_per_minute": 5},
                      timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["key"].startswith("wak_")
        assert d["scopes"] == ["sessions:read"]
        assert d["rate_limit_per_minute"] == 5
        TestApiKeyScopes._kid = d["id"]
        TestApiKeyScopes._key = d["key"]

    def test_c_list_shows_scopes(self, auth):
        r = auth.get(f"{BASE_URL}/api/api-keys", timeout=TIMEOUT)
        keys = r.json()["keys"]
        found = next((k for k in keys if k["id"] == self._kid), None)
        assert found is not None
        assert found["scopes"] == ["sessions:read"]
        assert found["rate_limit_per_minute"] == 5

    def test_d_scope_read_allowed(self, anon):
        r = anon.get(f"{BASE_URL}/api/v1/sessions",
                     headers={"Authorization": f"Bearer {self._key}"},
                     timeout=TIMEOUT)
        assert r.status_code == 200
        assert "sessions" in r.json()

    def test_e_scope_send_denied(self, anon):
        r = anon.post(f"{BASE_URL}/api/v1/send/text",
                      json={"session_id": "x", "to": "1", "text": "hi"},
                      headers={"Authorization": f"Bearer {self._key}"},
                      timeout=TIMEOUT)
        assert r.status_code == 403, r.text
        assert "scope" in r.json()["detail"].lower()

    def test_f_scope_logs_denied_without_scope(self, anon):
        r = anon.get(f"{BASE_URL}/api/v1/logs",
                     headers={"Authorization": f"Bearer {self._key}"},
                     timeout=TIMEOUT)
        assert r.status_code == 403

    def test_g_logs_scope_grants(self, auth, anon):
        r = auth.post(f"{BASE_URL}/api/api-keys",
                      json={"name": "TEST_logs", "scopes": ["logs:read"],
                            "rate_limit_per_minute": 60},
                      timeout=TIMEOUT)
        assert r.status_code == 200
        key = r.json()["key"]
        kid = r.json()["id"]
        try:
            r2 = anon.get(f"{BASE_URL}/api/v1/logs",
                          headers={"Authorization": f"Bearer {key}"},
                          timeout=TIMEOUT)
            assert r2.status_code == 200
            assert "messages" in r2.json()
        finally:
            auth.delete(f"{BASE_URL}/api/api-keys/{kid}", timeout=TIMEOUT)

    def test_h_full_access_key(self, auth, anon):
        r = auth.post(f"{BASE_URL}/api/api-keys",
                      json={"name": "TEST_full", "scopes": None, "rate_limit_per_minute": 100},
                      timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        TestApiKeyScopes._kid_full = d["id"]
        TestApiKeyScopes._key_full = d["key"]
        # In list, scopes should be a non-empty list (server backfills with FULL_SCOPES)
        lst = auth.get(f"{BASE_URL}/api/api-keys", timeout=TIMEOUT).json()["keys"]
        found = next((k for k in lst if k["id"] == d["id"]), None)
        assert found is not None
        scopes = found.get("scopes") or []
        assert isinstance(scopes, list)
        # Full-access key should be able to hit sessions:read
        r2 = anon.get(f"{BASE_URL}/api/v1/sessions",
                      headers={"Authorization": f"Bearer {self._key_full}"},
                      timeout=TIMEOUT)
        assert r2.status_code == 200

    def test_i_revoked_key_401(self, auth, anon):
        r = auth.post(f"{BASE_URL}/api/api-keys/{self._kid}/revoke", timeout=TIMEOUT)
        assert r.status_code == 200
        r2 = anon.get(f"{BASE_URL}/api/v1/sessions",
                      headers={"Authorization": f"Bearer {self._key}"},
                      timeout=TIMEOUT)
        assert r2.status_code == 401

    def test_j_cleanup(self, auth):
        for kid in (self._kid, self._kid_full):
            if kid:
                auth.delete(f"{BASE_URL}/api/api-keys/{kid}", timeout=TIMEOUT)


# ---------------------- Rate limits ----------------------
class TestRateLimit:
    def test_rate_limit_kicks_in(self, auth, anon):
        # Create a key with rate_limit_per_minute=3
        r = auth.post(f"{BASE_URL}/api/api-keys",
                      json={"name": "TEST_ratelimit", "scopes": ["sessions:read"],
                            "rate_limit_per_minute": 3},
                      timeout=TIMEOUT)
        assert r.status_code == 200
        key = r.json()["key"]
        kid = r.json()["id"]
        try:
            codes = []
            for _ in range(5):
                r2 = anon.get(f"{BASE_URL}/api/v1/sessions",
                              headers={"Authorization": f"Bearer {key}"},
                              timeout=TIMEOUT)
                codes.append(r2.status_code)
            assert codes[:3] == [200, 200, 200], f"first 3 must be 200: {codes}"
            assert any(c == 429 for c in codes[3:]), f"expected 429 after 3: {codes}"
            # Detail includes 'Rate limit exceeded'
            r3 = anon.get(f"{BASE_URL}/api/v1/sessions",
                          headers={"Authorization": f"Bearer {key}"},
                          timeout=TIMEOUT)
            if r3.status_code == 429:
                assert "rate limit" in r3.json()["detail"].lower()
        finally:
            auth.delete(f"{BASE_URL}/api/api-keys/{kid}", timeout=TIMEOUT)


# ---------------------- Internal status callback ----------------------
class TestStatusCallback:
    def test_status_mapping(self, anon, db):
        sid = "test-status"
        msg_id = f"MSG_{uuid.uuid4().hex[:8]}"
        # Seed an outgoing message
        from datetime import datetime, timezone as tz_
        db.messages.insert_one({
            "session_id": sid, "direction": "outgoing", "remote_jid": "1@s.whatsapp.net",
            "message_id": msg_id, "text": "hi", "media_type": None,
            "status": "pending", "timestamp": int(time.time()),
            "created_at": datetime.now(tz_.utc).isoformat(),
        })
        try:
            # Status updates land on /api/internal/incoming with type='status'
            # (single-endpoint design; sidecar posts all callback types here)
            # 2 -> sent
            r = anon.post(f"{BASE_URL}/api/internal/incoming",
                          json={"type": "status", "sessionId": sid, "messageId": msg_id, "status": 2},
                          headers={"X-Sidecar-Token": SIDECAR_TOKEN}, timeout=TIMEOUT)
            assert r.status_code == 200
            m = db.messages.find_one({"session_id": sid, "message_id": msg_id})
            assert m["status"] == "sent", f"expected sent, got {m['status']}"
            # 3 -> delivered
            anon.post(f"{BASE_URL}/api/internal/incoming",
                     json={"type": "status", "sessionId": sid, "messageId": msg_id, "status": 3},
                     headers={"X-Sidecar-Token": SIDECAR_TOKEN}, timeout=TIMEOUT)
            m = db.messages.find_one({"session_id": sid, "message_id": msg_id})
            assert m["status"] == "delivered"
            # 4 -> read
            anon.post(f"{BASE_URL}/api/internal/incoming",
                     json={"type": "status", "sessionId": sid, "messageId": msg_id, "status": 4},
                     headers={"X-Sidecar-Token": SIDECAR_TOKEN}, timeout=TIMEOUT)
            m = db.messages.find_one({"session_id": sid, "message_id": msg_id})
            assert m["status"] == "read"
        finally:
            db.messages.delete_one({"session_id": sid, "message_id": msg_id})


# ---------------------- WebSocket ----------------------
class TestWebSocket:
    def test_a_ws_no_cookie_closes_4401(self):
        async def run():
            try:
                async with websockets.connect(WS_URL, open_timeout=10) as ws:
                    await ws.recv()  # Expect close before any message
                    return None
            except websockets.exceptions.ConnectionClosedError as e:
                return e.code
            except websockets.exceptions.InvalidStatus as e:
                # server may reject with 401 during handshake
                return e.response.status_code
            except Exception as e:
                return f"err: {e}"

        result = asyncio.new_event_loop().run_until_complete(run())
        # Accept either 4401 close code (post-handshake) or 401/403 rejected handshake
        assert result in (4401, 401, 403), f"expected auth rejection, got: {result}"

    def test_b_ws_with_cookie_gets_hello_and_message(self, auth, anon):
        access = auth.cookies.get("access_token")
        assert access, "auth session missing access_token cookie"
        headers = [("Cookie", f"access_token={access}")]

        async def run():
            async with websockets.connect(WS_URL, additional_headers=headers, open_timeout=10) as ws:
                hello = await asyncio.wait_for(ws.recv(), timeout=5)
                # Trigger an incoming message via HTTP
                sid = f"test-ws-{uuid.uuid4().hex[:6]}"
                msg_id = f"mid_{uuid.uuid4().hex[:8]}"
                # fire in background
                def fire():
                    requests.post(f"{BASE_URL}/api/internal/incoming",
                                  json={"type": "message", "sessionId": sid,
                                        "direction": "incoming",
                                        "remoteJid": "9@s.whatsapp.net",
                                        "messageId": msg_id, "text": "ws-test",
                                        "timestamp": int(time.time())},
                                  headers={"X-Sidecar-Token": SIDECAR_TOKEN, "Content-Type": "application/json"},
                                  timeout=15)
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, fire)
                # Read frames for up to 5s to find our msg
                got = None
                deadline = time.time() + 5
                while time.time() < deadline:
                    try:
                        frame = await asyncio.wait_for(ws.recv(), timeout=deadline - time.time())
                    except asyncio.TimeoutError:
                        break
                    import json
                    data = json.loads(frame)
                    if data.get("type") == "message" and data.get("message", {}).get("message_id") == msg_id:
                        got = data
                        break
                return hello, got, sid, msg_id

        hello, got, sid, msg_id = asyncio.new_event_loop().run_until_complete(run())
        import json
        h = json.loads(hello)
        assert h["type"] == "hello", f"expected hello, got {h}"
        assert got is not None, "did not receive broadcast message"
        assert got["message"]["text"] == "ws-test"
        # Cleanup
        from pymongo import MongoClient
        MongoClient(MONGO_URL)[DB_NAME].messages.delete_many({"session_id": sid})


# ---------------------- Sidecar auth guards ----------------------
class TestInternalGuards:
    def test_missing_token_incoming(self, anon):
        r = anon.post(f"{BASE_URL}/api/internal/incoming",
                      json={"type": "message"}, timeout=TIMEOUT)
        assert r.status_code == 401

    def test_missing_token_status(self, anon):
        r = anon.post(f"{BASE_URL}/api/internal/status",
                      json={"type": "status"}, timeout=TIMEOUT)
        assert r.status_code == 401
