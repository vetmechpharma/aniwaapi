"""
Iteration 6 — VPS install guide HTML endpoint + regressions.

Covers:
  - GET /api/downloads/vps-install-guide.html
      * 200, Content-Type starts with 'text/html'
      * Content-Disposition attachment/filename includes 'WA_API_VPS_Install_Guide.html'
      * Body starts with '<!doctype html>' (case-insensitive) and >= 15 KB
      * Body contains ALL baked-in literals:
          'wa.animitra.in', '/opt/wa_api', '127.0.0.1:8004', ':3005', 'admin@animitra.in'
      * Body contains three required section headings:
          'Remove ANY previous nginx config'
          'Verify nginx is really serving WA_API'
          'Domain shows a different project' (case-insensitive)
  - Negative: if the HTML file is temporarily renamed, endpoint returns 404 (not 500)
  - PDF regression: GET /api/downloads/vps-install-guide.pdf still 200 + %PDF magic
  - Health/plans/admin-login regressions
"""
import os
import shutil
from pathlib import Path

import pytest
import requests

# --- resolve backend URL from frontend/.env if not already set
_FE_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if _FE_ENV.exists() and not os.environ.get("REACT_APP_BACKEND_URL"):
    for _line in _FE_ENV.read_text().splitlines():
        if _line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip().strip('"')
            break

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

HTML_URL = f"{BASE_URL}/api/downloads/vps-install-guide.html"
PDF_URL = f"{BASE_URL}/api/downloads/vps-install-guide.pdf"
LOCAL_HTML = Path("/app/backend/static/downloads/WA_API_VPS_Install_Guide.html")

BAKED_LITERALS = [
    "wa.animitra.in",
    "/opt/wa_api",
    "127.0.0.1:8004",
    ":3005",
    "admin@animitra.in",
]

REQUIRED_HEADINGS_CI = [
    "remove any previous nginx config",
    "verify nginx is really serving wa_api",
    "domain shows a different project",
]


# ---------- HTML endpoint tests ----------
class TestVpsInstallHtmlEndpoint:
    def test_endpoint_returns_html(self):
        r = requests.get(HTML_URL, timeout=30)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        ct = r.headers.get("content-type", "").lower()
        assert ct.startswith("text/html"), f"unexpected content-type: {ct}"

    def test_content_disposition_attachment_filename(self):
        r = requests.get(HTML_URL, timeout=30)
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        assert "WA_API_VPS_Install_Guide.html" in cd, (
            f"expected filename in Content-Disposition, got: {cd!r}"
        )
        # FastAPI FileResponse sets 'attachment' by default when filename is given
        assert "attachment" in cd.lower(), f"expected 'attachment' disposition, got: {cd!r}"

    def test_body_starts_with_doctype_and_min_size(self):
        r = requests.get(HTML_URL, timeout=30)
        assert r.status_code == 200
        body = r.text
        assert body.lstrip().lower().startswith("<!doctype html>"), (
            f"body does not start with <!doctype html>, first 80 chars: {body[:80]!r}"
        )
        size = len(r.content)
        assert size >= 15 * 1024, f"HTML is only {size} bytes, expected >= 15 KB"

    def test_body_contains_baked_values(self):
        r = requests.get(HTML_URL, timeout=30)
        assert r.status_code == 200
        body = r.text
        missing = [lit for lit in BAKED_LITERALS if lit not in body]
        assert not missing, f"baked-in values missing from HTML: {missing}"

    def test_body_contains_required_headings(self):
        r = requests.get(HTML_URL, timeout=30)
        assert r.status_code == 200
        body_lc = r.text.lower()
        missing = [h for h in REQUIRED_HEADINGS_CI if h not in body_lc]
        assert not missing, f"required section headings missing: {missing}"

    # Kept in same class so pytest-xdist loadscope pins it to the same worker
    # as the positive tests above; otherwise moving the file races the other
    # tests. This must be the LAST test of the class.
    def test_zzz_missing_file_returns_404(self):
        assert LOCAL_HTML.exists(), f"pre-condition: expected file at {LOCAL_HTML}"
        tmp = LOCAL_HTML.with_suffix(".html.__test_bak__")
        try:
            shutil.move(str(LOCAL_HTML), str(tmp))
            assert not LOCAL_HTML.exists(), "file should be moved away"
            r = requests.get(HTML_URL, timeout=30)
            assert r.status_code == 404, (
                f"expected 404 when file missing, got {r.status_code}: {r.text[:200]}"
            )
        finally:
            if tmp.exists():
                shutil.move(str(tmp), str(LOCAL_HTML))
            assert LOCAL_HTML.exists(), "post-condition: file must be restored"


# (kept for backwards clarity — no tests here; negative case lives in the
# main endpoint class so loadscope keeps everything on the same worker.)
class TestVpsInstallHtmlMissingFile:
    def test_placeholder(self):
        pytest.skip("negative test consolidated into TestVpsInstallHtmlEndpoint")


# ---------- PDF regression ----------
class TestPdfRegression:
    def test_pdf_still_served(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", f"PDF magic bytes wrong: {r.content[:8]!r}"


# ---------- Health / plans / auth regressions ----------
class TestGeneralRegression:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True, f"expected ok=true, got {body}"
        # optional fields per problem statement
        assert "sidecar" in body, f"missing sidecar in health body: {body}"
        assert "version" in body, f"missing version in health body: {body}"

    def test_plans_public(self):
        r = requests.get(f"{BASE_URL}/api/plans", timeout=15)
        assert r.status_code == 200
        body = r.json()
        if isinstance(body, dict) and "plans" in body:
            body = body["plans"]
        assert isinstance(body, list) and len(body) >= 1, f"unexpected plans body: {body!r}"

    def test_admin_login(self):
        s = requests.Session()
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@example.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
        cookies = {c.name for c in s.cookies}
        body = {}
        try:
            body = r.json()
        except Exception:
            pass
        assert cookies or body, "no auth cookies AND no body — login response is empty"
