"""Regression tests for WA sidecar getMessage cache fix and FastAPI endpoints."""
import os
import re
import requests
import pytest

BACKEND = os.environ.get("REACT_APP_BACKEND_URL", "https://whatsapp-server-4.preview.emergentagent.com").rstrip("/")
SIDECAR_URL = "http://localhost:3002"
SIDECAR_INDEX = "/app/wa-sidecar/index.js"


def _env_var(path, key):
    with open(path) as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


SIDECAR_TOKEN = _env_var("/app/backend/.env", "SIDECAR_TOKEN")


# ---------- Static code review of the fix ----------
class TestSidecarStaticFix:
    @classmethod
    def setup_class(cls):
        with open(SIDECAR_INDEX) as f:
            cls.src = f.read()

    def test_message_cache_constants(self):
        assert "MESSAGE_CACHE_MAX" in self.src
        assert "const messageCaches = new Map()" in self.src

    def test_getCache_and_cacheMessage_defined(self):
        assert re.search(r"function getCache\(sessionId\)", self.src)
        assert re.search(r"function cacheMessage\(sessionId, messageId, message\)", self.src)

    def test_lru_eviction_present(self):
        # size compared against MESSAGE_CACHE_MAX and oldest key deleted
        assert re.search(r"c\.size\s*>\s*MESSAGE_CACHE_MAX", self.src)
        assert "c.keys().next().value" in self.src

    def test_getMessage_wired_into_makeWASocket(self):
        # getMessage passed to makeWASocket and closes over sessionId via getCache(sessionId)
        m = re.search(r"getMessage:\s*async\s*\(key\)\s*=>\s*\{([^}]+)\}", self.src, re.S)
        assert m, "getMessage callback not found"
        body = m.group(1)
        assert "getCache(sessionId)" in body
        assert "cache.get(key.id)" in body

    def test_cacheMessage_called_in_messages_upsert_for_fromMe(self):
        assert re.search(r"if\s*\(fromMe\)\s*cacheMessage\(sessionId,\s*messageId,\s*msg\.message\)", self.src)

    def test_cacheMessage_after_send_text(self):
        # inside /send-text handler
        block = re.search(r"send-text.*?res\.json\(\{ ok: true, messageId", self.src, re.S).group(0)
        assert "cacheMessage(req.params.id" in block

    def test_cacheMessage_after_send_media(self):
        block = re.search(r"send-media.*?res\.json\(\{ ok: true, messageId", self.src, re.S).group(0)
        assert "cacheMessage(req.params.id" in block

    def test_cacheMessage_after_broadcast(self):
        block = re.search(r"broadcast.*?res\.json\(\{ ok: true, results", self.src, re.S).group(0)
        assert "cacheMessage(req.params.id" in block

    def test_cache_purged_on_logged_out(self):
        # in connection-close logged_out branch AND in DELETE /sessions/:id
        assert self.src.count("messageCaches.delete(sessionId)") >= 1
        assert "messageCaches.delete(sid)" in self.src


# ---------- Sidecar HTTP surface ----------
class TestSidecarRuntime:
    def test_health_unauthorized_without_token(self):
        r = requests.get(f"{SIDECAR_URL}/health", timeout=5)
        assert r.status_code == 401

    def test_health_ok_with_token(self):
        r = requests.get(f"{SIDECAR_URL}/health", headers={"X-Sidecar-Token": SIDECAR_TOKEN}, timeout=5)
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_sidecar_log_has_listening_line(self):
        with open("/var/log/supervisor/wa_sidecar.out.log") as f:
            content = f.read()
        assert "[sidecar] listening on 127.0.0.1:3002" in content


# ---------- FastAPI regression ----------
class TestBackendRegression:
    def test_health(self):
        r = requests.get(f"{BACKEND}/api/health", timeout=15)
        assert r.status_code == 200
        # body should be JSON
        r.json()

    def test_admin_login(self):
        r = requests.post(
            f"{BACKEND}/api/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # token present in body OR httpOnly cookie set
        has_token = any(k in data for k in ("access_token", "token"))
        has_cookie = any("access" in c.name.lower() or "token" in c.name.lower() or "session" in c.name.lower()
                          for c in r.cookies)
        assert has_token or has_cookie, f"No token/cookie in login response: {data}"

    def test_sessions_list_authenticated(self):
        # login then GET /api/sessions
        s = requests.Session()
        lr = s.post(
            f"{BACKEND}/api/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
            timeout=15,
        )
        assert lr.status_code == 200
        data = lr.json()
        headers = {}
        tok = data.get("access_token") or data.get("token")
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        r = s.get(f"{BACKEND}/api/sessions", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, (list, dict))
