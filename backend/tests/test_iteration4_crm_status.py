"""
Iteration 4 — CRM connection-status bug retest.

Bug: /api/v1/sessions* responses did not clearly indicate whether a WhatsApp
session was connected. We now assert every response carries:
  - connected: bool
  - status: normalised string (not 'unknown' unless sidecar unreachable)
  - phone : str|null
  - ready : bool (alias of connected)

Endpoints under test:
  GET /api/v1/sessions
  GET /api/v1/sessions/{slug}
  GET /api/v1/sessions/{slug}/status

Auth: uses cookie-auth (admin) to create a session + create an API key
(with default = FULL scopes which include sessions:read), then uses the
Bearer key against the v1 endpoints.

Cleanup: deletes the seeded session and revokes the API key at teardown.
"""
import os
from pathlib import Path
import pytest
import requests

# Load REACT_APP_BACKEND_URL from /app/frontend/.env (public URL used by the app itself)
_FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if _FRONTEND_ENV.exists() and not os.environ.get("REACT_APP_BACKEND_URL"):
    for _line in _FRONTEND_ENV.read_text().splitlines():
        if _line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip().strip('"')
            break

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "admin@example.com"
ADMIN_PW = "admin123"
SESSION_SLUG = "crmtest"

VALID_STATUSES = {
    "connected", "connecting", "reconnecting", "qr", "pairing",
    "logged_out", "disconnected", "unknown",
}
# When sidecar is reachable, status must NOT be "unknown"
CONNECTED_FALSE_STATUSES = {
    "qr", "connecting", "reconnecting", "pairing", "disconnected", "logged_out",
}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def seeded(admin_session):
    """Create a fresh session + api key, yield (session_slug, api_key), then cleanup."""
    s = admin_session

    # Ensure the slug is not left over from a previous run
    s.delete(f"{BASE_URL}/api/sessions/{SESSION_SLUG}", timeout=15)

    # Create the session (sidecar will bring it up in qr/connecting state)
    r = s.post(f"{BASE_URL}/api/sessions",
               json={"session_id": SESSION_SLUG}, timeout=30)
    assert r.status_code == 200, f"create session failed: {r.status_code} {r.text}"

    # Create the API key with default (FULL) scopes
    r = s.post(f"{BASE_URL}/api/api-keys",
               json={"name": "crm-test"}, timeout=15)
    assert r.status_code == 200, f"create api key failed: {r.status_code} {r.text}"
    body = r.json()
    api_key = body["key"]
    key_id = body["id"]

    # Give the sidecar a couple of seconds to populate live status
    import time
    time.sleep(2)

    yield {"slug": SESSION_SLUG, "key": api_key, "key_id": key_id}

    # ---- teardown ----
    try:
        s.delete(f"{BASE_URL}/api/sessions/{SESSION_SLUG}", timeout=15)
    except Exception:
        pass
    try:
        # revoke first, then hard-delete
        s.post(f"{BASE_URL}/api/api-keys/{key_id}/revoke", timeout=15)
        s.delete(f"{BASE_URL}/api/api-keys/{key_id}", timeout=15)
    except Exception:
        pass


def _bearer(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"}


# ---------- helpers ----------
def _assert_enriched_shape(item: dict):
    """Every session object from v1 endpoints must have these fields."""
    for f in ("id", "slug", "status", "connected", "ready",
              "phone", "me", "hasQr", "pairingCode",
              "lastError", "sidecar_reachable", "checked_at"):
        assert f in item, f"missing field '{f}' in {item.keys()}"

    # types
    assert isinstance(item["connected"], bool), \
        f"'connected' must be bool, got {type(item['connected']).__name__}"
    assert isinstance(item["ready"], bool), \
        f"'ready' must be bool, got {type(item['ready']).__name__}"
    assert item["connected"] == item["ready"], \
        f"'ready' should mirror 'connected': got {item['ready']} vs {item['connected']}"
    assert isinstance(item["status"], str) and item["status"] in VALID_STATUSES, \
        f"'status' must be one of {VALID_STATUSES}, got {item['status']!r}"
    assert isinstance(item["sidecar_reachable"], bool)
    assert isinstance(item["hasQr"], bool)
    # phone may be null when disconnected
    assert item["phone"] is None or isinstance(item["phone"], str)
    assert isinstance(item["checked_at"], str) and len(item["checked_at"]) >= 10


# ---------- tests ----------
class TestPublicListSessions:
    """GET /api/v1/sessions"""

    def test_list_requires_bearer(self):
        r = requests.get(f"{BASE_URL}/api/v1/sessions", timeout=15)
        assert r.status_code == 401, f"expected 401 without auth, got {r.status_code}"

    def test_list_rejects_bad_key(self):
        r = requests.get(f"{BASE_URL}/api/v1/sessions",
                         headers=_bearer("wak_not-a-real-key"), timeout=15)
        assert r.status_code == 401

    def test_list_returns_enriched_sessions(self, seeded):
        r = requests.get(f"{BASE_URL}/api/v1/sessions",
                         headers=_bearer(seeded["key"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sessions" in body and isinstance(body["sessions"], list)
        # our seeded session must be present
        ours = [x for x in body["sessions"] if x["slug"] == seeded["slug"]]
        assert len(ours) == 1, \
            f"seeded slug '{seeded['slug']}' not present in list: {[x.get('slug') for x in body['sessions']]}"
        item = ours[0]
        _assert_enriched_shape(item)

        # Unscanned session must NOT be connected
        assert item["connected"] is False, \
            f"newly-created session should not be connected, got connected={item['connected']} status={item['status']}"

        # And when the sidecar is reachable, status must not be 'unknown'
        if item["sidecar_reachable"]:
            assert item["status"] != "unknown", \
                f"sidecar reachable but status='unknown' — bug NOT fixed"
            assert item["status"] in CONNECTED_FALSE_STATUSES, \
                f"expected qr/connecting/disconnected/... got {item['status']!r}"

        # Phone must be null when disconnected
        assert item["phone"] is None, \
            f"phone must be null when disconnected, got {item['phone']!r}"


class TestPublicGetSession:
    """GET /api/v1/sessions/{slug}"""

    def test_requires_bearer(self, seeded):
        r = requests.get(f"{BASE_URL}/api/v1/sessions/{seeded['slug']}", timeout=15)
        assert r.status_code == 401

    def test_returns_enriched_shape(self, seeded):
        r = requests.get(f"{BASE_URL}/api/v1/sessions/{seeded['slug']}",
                         headers=_bearer(seeded["key"]), timeout=15)
        assert r.status_code == 200, r.text
        item = r.json()
        _assert_enriched_shape(item)
        assert item["slug"] == seeded["slug"]
        assert item["id"] == seeded["slug"]
        assert item["connected"] is False
        if item["sidecar_reachable"]:
            assert item["status"] != "unknown"
            assert item["status"] in CONNECTED_FALSE_STATUSES

    def test_missing_slug_returns_404(self, seeded):
        r = requests.get(f"{BASE_URL}/api/v1/sessions/does-not-exist-slug",
                         headers=_bearer(seeded["key"]), timeout=15)
        assert r.status_code == 404


class TestPublicSessionStatus:
    """GET /api/v1/sessions/{slug}/status  — lightweight poll shape"""

    def test_requires_bearer(self, seeded):
        r = requests.get(f"{BASE_URL}/api/v1/sessions/{seeded['slug']}/status", timeout=15)
        assert r.status_code == 401

    def test_status_shape(self, seeded):
        r = requests.get(
            f"{BASE_URL}/api/v1/sessions/{seeded['slug']}/status",
            headers=_bearer(seeded["key"]), timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for f in ("id", "connected", "status", "phone",
                  "sidecar_reachable", "checked_at"):
            assert f in body, f"missing '{f}' in status shape: {body.keys()}"

        assert isinstance(body["connected"], bool)
        assert isinstance(body["status"], str) and body["status"] in VALID_STATUSES
        assert body["phone"] is None or isinstance(body["phone"], str)
        assert isinstance(body["sidecar_reachable"], bool)
        assert isinstance(body["checked_at"], str)
        assert body["id"] == seeded["slug"]
        # unscanned → not connected
        assert body["connected"] is False
        if body["sidecar_reachable"]:
            assert body["status"] != "unknown", "bug NOT fixed — sidecar reachable but status='unknown'"

    def test_status_missing_slug_returns_404(self, seeded):
        r = requests.get(
            f"{BASE_URL}/api/v1/sessions/does-not-exist-slug/status",
            headers=_bearer(seeded["key"]), timeout=15,
        )
        assert r.status_code == 404


class TestDashboardRegression:
    """GET /api/sessions (cookie-auth) must also return the enriched shape."""

    def test_dashboard_list_enriched(self, admin_session, seeded):
        r = admin_session.get(f"{BASE_URL}/api/sessions", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "sessions" in body and isinstance(body["sessions"], list)
        ours = [x for x in body["sessions"] if x["slug"] == seeded["slug"]]
        assert len(ours) == 1
        _assert_enriched_shape(ours[0])
        assert ours[0]["connected"] is False

    def test_dashboard_get_one_enriched(self, admin_session, seeded):
        r = admin_session.get(f"{BASE_URL}/api/sessions/{seeded['slug']}", timeout=15)
        assert r.status_code == 200
        _assert_enriched_shape(r.json())


class TestScopeGuard:
    """API keys lacking sessions:read must be rejected with 403."""

    def test_scope_missing_returns_403(self, admin_session, seeded):
        # Create a narrow-scope key (only send:text) — should NOT list sessions
        r = admin_session.post(
            f"{BASE_URL}/api/api-keys",
            json={"name": "narrow-crm-test", "scopes": ["send:text"]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        narrow_key = r.json()["key"]
        narrow_id = r.json()["id"]
        try:
            r = requests.get(f"{BASE_URL}/api/v1/sessions",
                             headers=_bearer(narrow_key), timeout=15)
            assert r.status_code == 403, f"expected 403 for missing scope, got {r.status_code}: {r.text}"

            r = requests.get(f"{BASE_URL}/api/v1/sessions/{seeded['slug']}/status",
                             headers=_bearer(narrow_key), timeout=15)
            assert r.status_code == 403
        finally:
            admin_session.post(f"{BASE_URL}/api/api-keys/{narrow_id}/revoke", timeout=15)
            admin_session.delete(f"{BASE_URL}/api/api-keys/{narrow_id}", timeout=15)
