"""
Iteration-3 backend tests: Admin user CRUD, feature flags/limits, SMTP config,
OTP forgot-password flow, admin change password, admin send-text 404 path,
feature-flag enforcement on /api/send/text.
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Load backend .env to obtain MONGO_URL / DB_NAME
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if FRONTEND_ENV.exists():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip().strip('"')

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TIMEOUT = 30


@pytest.fixture(scope="module")
def db():
    from pymongo import MongoClient
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def any_plan_id(admin):
    r = admin.get(f"{BASE_URL}/api/admin/plans", timeout=TIMEOUT)
    assert r.status_code == 200
    plans = r.json().get("plans", [])
    if not plans:
        # create one
        r = admin.post(f"{BASE_URL}/api/admin/plans",
                       json={"name": "TEST_Plan", "price_inr": 0, "price_usd": 0,
                             "validity_days": 30, "max_sessions": 2,
                             "max_messages_per_day": 100, "max_api_keys": 2,
                             "max_rules": 10, "max_webhooks": 5,
                             "features": [], "feature_flags": {}, "active": True},
                       timeout=TIMEOUT)
        assert r.status_code == 201
        return r.json()["id"]
    return plans[0]["id"]


# ----------------- Admin user CRUD -----------------
class TestAdminUserCRUD:
    _uid = None
    _email = f"test_it3_{uuid.uuid4().hex[:8]}@example.com"
    _pw = "InitialPass123!"

    def test_a_create_user(self, admin, any_plan_id):
        body = {"email": self._email, "password": self._pw, "name": "It3 User",
                "company": "TestCo", "phone": "+11234567890",
                "role": "user", "status": "approved", "plan_id": any_plan_id}
        r = admin.post(f"{BASE_URL}/api/admin/users", json=body, timeout=TIMEOUT)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["ok"] is True
        assert "id" in d and d["email"] == self._email
        assert "welcome_email_sent" in d
        TestAdminUserCRUD._uid = d["id"]

    def test_b_list_shows_effective_flags_and_limits(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/users", timeout=TIMEOUT)
        assert r.status_code == 200
        users = r.json()["users"]
        row = next((u for u in users if u["id"] == self._uid), None)
        assert row is not None, "created user missing in list"
        assert isinstance(row["effective_feature_flags"], dict)
        assert isinstance(row["effective_limits"], dict)
        # default keys present
        for k in ("send_text", "send_media", "broadcast", "rules", "webhooks",
                  "api_access", "multi_session", "business_hours", "groups", "logs"):
            assert k in row["effective_feature_flags"], f"missing flag {k}"

    def test_c_new_user_can_login(self, anon):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": self._email, "password": self._pw}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_d_edit_user(self, admin, any_plan_id):
        r = admin.put(f"{BASE_URL}/api/admin/users/{self._uid}",
                      json={"name": "It3 Renamed", "company": "NewCo",
                            "phone": "+19998887777", "plan_id": any_plan_id,
                            "validity_days": 15},
                      timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "It3 Renamed"
        assert d["company"] == "NewCo"
        assert d.get("current_plan_id") == any_plan_id
        assert d.get("subscription_expires_at")

    def test_e_extend_days(self, admin):
        # Get current expiry
        before = admin.get(f"{BASE_URL}/api/admin/users", timeout=TIMEOUT).json()["users"]
        prev_row = next(u for u in before if u["id"] == self._uid)
        prev_exp = prev_row.get("subscription_expires_at")
        r = admin.put(f"{BASE_URL}/api/admin/users/{self._uid}",
                      json={"extend_days": 5}, timeout=TIMEOUT)
        assert r.status_code == 200
        after = admin.get(f"{BASE_URL}/api/admin/users", timeout=TIMEOUT).json()["users"]
        new_row = next(u for u in after if u["id"] == self._uid)
        assert new_row.get("subscription_expires_at") != prev_exp

    def test_f_set_password(self, admin, anon):
        new_pw = "ChangedPass456!"
        r = admin.put(f"{BASE_URL}/api/admin/users/{self._uid}/password",
                      json={"password": new_pw, "notify_email": False}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        # login with new
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": self._email, "password": new_pw}, timeout=TIMEOUT)
        assert r.status_code == 200, "new password should work"
        TestAdminUserCRUD._pw = new_pw

    def test_g_features_toggle_persists(self, admin):
        r = admin.put(f"{BASE_URL}/api/admin/users/{self._uid}/features",
                      json={"feature_flags": {"send_text": False, "broadcast": True},
                            "limits": {"max_sessions": 7, "max_api_keys": 4}},
                      timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        # verify via GET list
        row = next(u for u in admin.get(f"{BASE_URL}/api/admin/users",
                                        timeout=TIMEOUT).json()["users"]
                   if u["id"] == self._uid)
        assert row["effective_feature_flags"]["send_text"] is False
        assert row["effective_feature_flags"]["broadcast"] is True
        assert row["effective_limits"]["max_sessions"] == 7
        assert row["effective_limits"]["max_api_keys"] == 4

    def test_h_send_text_denied_by_flag(self, anon):
        """When feature_flags.send_text is False, POST /api/send/text returns 403 for that user."""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": self._email, "password": self._pw}, timeout=TIMEOUT)
        assert r.status_code == 200
        r = s.post(f"{BASE_URL}/api/send/text",
                   json={"session_id": "does-not-matter", "to": "911234567890",
                         "text": "hi"}, timeout=TIMEOUT)
        # Expect 403 (feature flag disabled). Do NOT accept 404/409 for this test.
        assert r.status_code == 403, f"expected 403 feature-flag denial, got {r.status_code}: {r.text}"

    def test_i_delete_user_and_cleanup(self, admin, anon):
        r = admin.delete(f"{BASE_URL}/api/admin/users/{self._uid}", timeout=TIMEOUT)
        assert r.status_code == 200
        # Can no longer login
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": self._email, "password": self._pw}, timeout=TIMEOUT)
        assert r.status_code == 401


# ----------------- Admin change own password -----------------
class TestAdminChangeOwnPassword:
    def test_wrong_current_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/admin/change-password",
                       json={"current_password": "totally-wrong",
                             "new_password": "should-not-matter-123"},
                       timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_correct_then_revert(self, admin, anon):
        intermediate = "TmpAdminPw_98765!"
        # change to intermediate
        r = admin.post(f"{BASE_URL}/api/admin/change-password",
                       json={"current_password": ADMIN_PASSWORD,
                             "new_password": intermediate}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        # login with new
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": intermediate}, timeout=TIMEOUT)
        assert r.status_code == 200, "new admin password should work"
        # revert
        r = s.post(f"{BASE_URL}/api/admin/change-password",
                   json={"current_password": intermediate,
                         "new_password": ADMIN_PASSWORD}, timeout=TIMEOUT)
        assert r.status_code == 200
        # confirm original works
        s2 = requests.Session(); s2.headers.update({"Content-Type": "application/json"})
        r = s2.post(f"{BASE_URL}/api/auth/login",
                    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
        assert r.status_code == 200


# ----------------- OTP forgot-password flow -----------------
class TestForgotPasswordOtp:
    _email = f"test_otp_{uuid.uuid4().hex[:8]}@example.com"
    _pw_initial = "InitOtpPass123!"
    _pw_reset = "ResetOtpPass456!"
    _uid = None

    @pytest.fixture(autouse=True, scope="class")
    def _create_user(self, admin, db):
        r = admin.post(f"{BASE_URL}/api/admin/users",
                       json={"email": self._email, "password": self._pw_initial,
                             "name": "OTP User", "phone": "+15550001111",
                             "role": "user", "status": "approved"}, timeout=TIMEOUT)
        assert r.status_code == 201, r.text
        TestForgotPasswordOtp._uid = r.json()["id"]
        yield
        try:
            admin.delete(f"{BASE_URL}/api/admin/users/{self._uid}", timeout=TIMEOUT)
        except Exception:
            pass

    def test_a_request_otp_creates_doc(self, anon, db):
        r = anon.post(f"{BASE_URL}/api/auth/forgot-password",
                      json={"email": self._email}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        # OTP doc should exist in db.password_resets
        time.sleep(0.5)
        doc = db.password_resets.find_one(
            {"email": self._email, "used": False},
            sort=[("created_at", -1)]
        )
        assert doc is not None, "password_resets doc not found"
        assert "otp" in doc and doc["otp"].isdigit() and len(doc["otp"]) == 6

    def test_b_verify_wrong_otp_400(self, anon):
        r = anon.post(f"{BASE_URL}/api/auth/verify-otp",
                      json={"email": self._email, "otp": "000000"}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_c_verify_correct_otp(self, anon, db):
        doc = db.password_resets.find_one(
            {"email": self._email, "used": False},
            sort=[("created_at", -1)]
        )
        otp = doc["otp"]
        r = anon.post(f"{BASE_URL}/api/auth/verify-otp",
                      json={"email": self._email, "otp": otp}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

    def test_d_reset_password_with_otp(self, anon, db):
        doc = db.password_resets.find_one(
            {"email": self._email, "used": False},
            sort=[("created_at", -1)]
        )
        otp = doc["otp"]
        r = anon.post(f"{BASE_URL}/api/auth/reset-password",
                      json={"email": self._email, "otp": otp,
                            "password": self._pw_reset}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_e_login_with_new_password(self, anon):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": self._email, "password": self._pw_reset},
                   timeout=TIMEOUT)
        assert r.status_code == 200


# ----------------- SMTP settings -----------------
class TestSmtpSettings:
    def test_get_masked(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/settings/smtp", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        # password should be either "" or masked
        assert "host" in d and "from_email" in d and "port" in d
        if d.get("password"):
            assert set(d["password"]) == {"•"}, f"password not masked: {d['password']!r}"

    def test_put_keeps_password_when_empty(self, admin, db):
        # seed a real password first
        await_pw = "seed-secret"
        db.settings.update_one({"key": "smtp"},
                               {"$set": {"key": "smtp", "host": "smtp.old.com",
                                         "port": 587, "username": "u",
                                         "password": await_pw, "use_tls": True,
                                         "use_ssl": False, "from_name": "Old",
                                         "from_email": "old@example.com",
                                         "enabled": False}},
                               upsert=True)
        # Now PUT without password
        r = admin.put(f"{BASE_URL}/api/admin/settings/smtp",
                      json={"host": "smtp.new.com", "port": 587, "username": "u2",
                            "password": "", "use_tls": True, "use_ssl": False,
                            "from_name": "New", "from_email": "new@example.com",
                            "enabled": False}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        raw = db.settings.find_one({"key": "smtp"})
        assert raw["password"] == await_pw, "existing password should be preserved when empty body"
        assert raw["host"] == "smtp.new.com"
        assert raw["from_email"] == "new@example.com"

    def test_put_updates_password_when_provided(self, admin, db):
        r = admin.put(f"{BASE_URL}/api/admin/settings/smtp",
                      json={"host": "smtp.example.com", "port": 587, "username": "u",
                            "password": "brand-new-pw", "use_tls": True,
                            "use_ssl": False, "from_name": "T",
                            "from_email": "test@example.com", "enabled": False},
                      timeout=TIMEOUT)
        assert r.status_code == 200
        raw = db.settings.find_one({"key": "smtp"})
        assert raw["password"] == "brand-new-pw"


# ----------------- Admin user sessions & send/text 404 -----------------
class TestAdminSessions:
    def test_list_user_sessions(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/user-sessions", timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["sessions"], list)
        # Optional shape check when at least one session exists
        for s in d["sessions"]:
            assert "owner_id" in s and "slug" in s and "status" in s

    def test_send_text_404_for_bad_session(self, admin):
        r = admin.post(f"{BASE_URL}/api/admin/send/text",
                       json={"user_id": "0" * 24,
                             "session_slug": "definitely-not-a-real-slug",
                             "to": "911234567890", "text": "hi"},
                       timeout=TIMEOUT)
        assert r.status_code == 404, r.text
