"""
Iteration 5 — VPS install guide PDF + regression.

Covers:
  - GET /api/downloads/vps-install-guide.pdf (public)
      * 200, Content-Type application/pdf
      * first bytes are '%PDF'
      * >= 60 KB
      * >= 8 pages
      * byte-identical (or size within 5%) to
        /app/backend/static/downloads/WA_API_VPS_Install_Guide.pdf
      * contains the two new phrases:
          '7.0 Remove ANY previous nginx config'
          'Domain shows a DIFFERENT project'
  - build_install_pdf.py is idempotent (run twice, still starts with %PDF)
  - Regression:
      * GET /api/health returns 200 + {ok: true}
      * GET /api/plans returns 200 + list
      * POST /api/auth/login (admin@example.com/admin123) returns 200
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest
import requests
from pypdf import PdfReader

# ---- resolve backend URL from frontend/.env if not already set
_FE_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if _FE_ENV.exists() and not os.environ.get("REACT_APP_BACKEND_URL"):
    for _line in _FE_ENV.read_text().splitlines():
        if _line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip().strip('"')
            break

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

PDF_URL = f"{BASE_URL}/api/downloads/vps-install-guide.pdf"
LOCAL_PDF = Path("/app/backend/static/downloads/WA_API_VPS_Install_Guide.pdf")
BUILD_SCRIPT = Path("/app/scripts/build_install_pdf.py")

# Each entry is a tuple of acceptable variants; the test passes for a given
# item if ANY of its variants is present in the PDF. The first item's second
# variant tolerates the ⚠ warning glyph that appears in the actual heading
# ("### 7.0 ⚠ Remove ANY previous nginx config …").
REQUIRED_PHRASES = [
    (
        "7.0 Remove ANY previous nginx config",
        "7.0 ⚠ Remove ANY previous nginx config",
        "Remove ANY previous nginx config",
    ),
    ("Domain shows a DIFFERENT project",),
]


# ---------- helpers ----------
def _extract_text(pdf_bytes: bytes) -> str:
    from io import BytesIO
    reader = PdfReader(BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def _normalise(text: str) -> str:
    # PDF layout extraction may inject line-breaks/soft-hyphens; normalise whitespace
    return " ".join(text.split())


# ---------- PDF endpoint tests ----------
class TestVpsInstallPdfEndpoint:
    def test_endpoint_returns_pdf(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf"), \
            f"unexpected content-type: {r.headers.get('content-type')}"
        assert r.content[:4] == b"%PDF", \
            f"body does not begin with %PDF magic bytes: {r.content[:8]!r}"

    def test_pdf_size_at_least_60kb(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200
        size = len(r.content)
        assert size >= 60 * 1024, f"PDF is only {size} bytes, expected >= 60 KB"

    def test_pdf_at_least_8_pages(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200
        from io import BytesIO
        reader = PdfReader(BytesIO(r.content))
        assert len(reader.pages) >= 8, f"expected >= 8 pages, got {len(reader.pages)}"

    def test_served_pdf_matches_local(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200
        assert LOCAL_PDF.exists(), f"local PDF missing at {LOCAL_PDF}"
        local_bytes = LOCAL_PDF.read_bytes()
        # Prefer byte-identical, but tolerate a size delta up to 5% (e.g. mtime-driven rebuild)
        if r.content == local_bytes:
            return
        ratio = abs(len(r.content) - len(local_bytes)) / max(len(local_bytes), 1)
        assert ratio <= 0.05, (
            f"served PDF differs from local by {ratio*100:.1f}% "
            f"(served={len(r.content)}, local={len(local_bytes)})"
        )

    def test_pdf_contains_new_phrases(self):
        r = requests.get(PDF_URL, timeout=60)
        assert r.status_code == 200
        text = _extract_text(r.content)
        norm = _normalise(text)
        # Also try direct substring in raw text in case pypdf preserves the phrase
        missing = []
        for variants in REQUIRED_PHRASES:
            hit = False
            for phrase in variants:
                if phrase in text or phrase in norm:
                    hit = True
                    break
            if hit:
                continue
            # fall back to pdftotext -layout if available
            try:
                tmp = Path("/tmp/_vps_guide.pdf")
                tmp.write_bytes(r.content)
                out = subprocess.check_output(
                    ["pdftotext", "-layout", str(tmp), "-"],
                    stderr=subprocess.DEVNULL, timeout=30,
                ).decode("utf-8", errors="ignore")
                for phrase in variants:
                    if phrase in out or phrase in _normalise(out):
                        hit = True
                        break
            except Exception:
                pass
            if not hit:
                missing.append(variants[0])
        assert not missing, f"phrases NOT found in the served PDF: {missing}"


# ---------- build script idempotency ----------
class TestBuildScriptIdempotent:
    def test_build_script_runs_twice(self):
        assert BUILD_SCRIPT.exists(), f"build script missing at {BUILD_SCRIPT}"
        for i in (1, 2):
            r = subprocess.run(
                [sys.executable, str(BUILD_SCRIPT)],
                capture_output=True, text=True, timeout=120,
            )
            assert r.returncode == 0, (
                f"run #{i} failed rc={r.returncode}\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
            )
            assert LOCAL_PDF.exists(), f"run #{i}: PDF not produced"
            head = LOCAL_PDF.read_bytes()[:4]
            assert head == b"%PDF", f"run #{i}: PDF magic bytes wrong: {head!r}"


# ---------- Regression ----------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True, f"expected ok=true, got {body}"

    def test_plans_public(self):
        r = requests.get(f"{BASE_URL}/api/plans", timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Accept either a list or an object with 'plans'
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
        # httpOnly cookie should be set
        cookies = {c.name for c in s.cookies}
        # We at least expect *some* auth cookie or a token in body
        body = {}
        try:
            body = r.json()
        except Exception:
            pass
        assert cookies or body, "no auth cookies AND no body — login response is empty"
