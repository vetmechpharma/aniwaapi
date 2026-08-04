"""
Iteration 7 — extra assertions for VPS install guide v2 (isolation-first).

Verifies review-request items not covered by iteration 6:
  * body size < 30 KB (v2 is intentionally short)
  * isolation-namespace literals present
  * §0 pre-flight collision-check commands present verbatim
  * §8 uninstall reset commands present verbatim
"""
import os
from pathlib import Path

import requests

_FE_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if _FE_ENV.exists() and not os.environ.get("REACT_APP_BACKEND_URL"):
    for _line in _FE_ENV.read_text().splitlines():
        if _line.startswith("REACT_APP_BACKEND_URL"):
            os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip().strip('"')
            break

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
HTML_URL = f"{BASE_URL}/api/downloads/vps-install-guide.html"


def _get_body():
    r = requests.get(HTML_URL, timeout=30)
    assert r.status_code == 200
    return r.text, len(r.content)


class TestV2ShortSize:
    def test_size_under_30kb(self):
        _, size = _get_body()
        assert 15 * 1024 <= size < 30 * 1024, f"expected 15KB<=size<30KB, got {size}"


class TestV2IsolationNamespaces:
    def test_isolation_literals_present(self):
        body, _ = _get_body()
        for lit in [
            "wa_api_backend",
            "wa_api_sidecar",
            "wa_api_db",
            "/var/log/wa_api",
            "sites-available/wa_api.conf",
        ]:
            assert lit in body, f"isolation namespace missing: {lit!r}"


class TestV2PreflightCommands:
    def test_preflight_commands_verbatim(self):
        body, _ = _get_body()
        for lit in [
            "ss -tlnp | grep -E",
            "id wa_api 2>/dev/null",
            "test -e /opt/wa_api",
            'grep -rli "wa.animitra.in" /etc/nginx/',
        ]:
            assert lit in body, f"pre-flight command missing verbatim: {lit!r}"


class TestV2UninstallCommands:
    def test_uninstall_commands_verbatim(self):
        body, _ = _get_body()
        for lit in [
            "supervisorctl stop wa_api_backend wa_api_sidecar",
            "sites-enabled/wa_api.conf",
            "db.dropDatabase()",
        ]:
            assert lit in body, f"uninstall command missing verbatim: {lit!r}"
