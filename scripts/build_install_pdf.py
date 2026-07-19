"""
Convert the VPS install guide (Markdown) into a nicely typeset PDF.
Uses fpdf2 — pure-python, no system deps.
Run: python /app/scripts/build_install_pdf.py
Output: /app/backend/static/downloads/WA_API_VPS_Install_Guide.pdf
"""
import os
import re
import subprocess
import sys
from pathlib import Path
from fpdf import FPDF

# Ensure the DejaVu Unicode fonts we need are actually present on the host.
# In fresh containers the package may be missing, so install it if needed.
def _ensure_fonts() -> None:
    font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    if font_path.exists():
        return
    print("Installing fonts-dejavu-core (needed for PDF Unicode glyphs)…", flush=True)
    for cmd in (
        ["apt-get", "install", "-y", "--no-install-recommends", "fonts-dejavu-core"],
        ["sudo", "apt-get", "install", "-y", "--no-install-recommends", "fonts-dejavu-core"],
    ):
        try:
            subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if font_path.exists():
                return
        except Exception:
            continue
    raise RuntimeError("Could not install fonts-dejavu-core. Install manually: apt-get install -y fonts-dejavu-core")

_ensure_fonts()

MD_PATH = Path("/app/docs/VPS_INSTALL.md")
OUT_DIR = Path("/app/backend/static/downloads")
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PDF = OUT_DIR / "WA_API_VPS_Install_Guide.pdf"

# Emerald / WhatsApp accent colours consistent with the brand
BRAND_GREEN = (37, 211, 102)
DEEP_TEAL = (18, 140, 126)
TEXT = (20, 25, 30)
MUTED = (100, 110, 118)
BG_CODE = (245, 247, 249)
BG_TABLE_HEAD = (232, 240, 236)
BORDER = (222, 227, 232)

PAGE_WIDTH = 210  # A4 mm
PAGE_MARGIN = 15
CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN

# Unicode-capable fonts (installed via fonts-dejavu-core)
FONT_DIR = "/usr/share/fonts/truetype/dejavu"
SANS_REG = f"{FONT_DIR}/DejaVuSans.ttf"
SANS_BOLD = f"{FONT_DIR}/DejaVuSans-Bold.ttf"
MONO_REG = f"{FONT_DIR}/DejaVuSansMono.ttf"

# Font aliases we'll use throughout the doc
F_SANS = "DejaVu"
F_MONO = "DejaVuMono"


class Guide(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font(F_SANS, "B", 9)
        self.set_text_color(*DEEP_TEAL)
        self.cell(0, 8, "WA_API SaaS - VPS Deployment Guide", align="L")
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"Page {self.page_no() - 1}", align="R")
        self.ln(10)
        self.set_draw_color(*BORDER)
        self.set_line_width(0.2)
        self.line(PAGE_MARGIN, self.get_y(), PAGE_WIDTH - PAGE_MARGIN, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-14)
        self.set_font(F_SANS, "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, "Version 1.0 · February 2026 · Keep this document with your VPS credentials.", align="C")


def add_cover(pdf: Guide) -> None:
    pdf.add_page()
    # Green accent bar
    pdf.set_fill_color(*BRAND_GREEN)
    pdf.rect(0, 0, PAGE_WIDTH, 4, "F")
    pdf.set_fill_color(*DEEP_TEAL)
    pdf.rect(0, 4, PAGE_WIDTH, 2, "F")

    pdf.set_y(60)
    pdf.set_font(F_SANS, "", 12)
    pdf.set_text_color(*DEEP_TEAL)
    pdf.cell(0, 8, "SELF-HOSTED · UNOFFICIAL WHATSAPP API", align="C")
    pdf.ln(8)

    pdf.set_font(F_SANS, "B", 34)
    pdf.set_text_color(*TEXT)
    pdf.multi_cell(0, 14, "WA_API SaaS", align="C")
    pdf.ln(2)
    pdf.set_font(F_SANS, "", 20)
    pdf.set_text_color(*DEEP_TEAL)
    pdf.multi_cell(0, 10, "VPS Deployment Guide", align="C")
    pdf.ln(20)

    pdf.set_font(F_SANS, "", 12)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 7,
        "A complete, step-by-step recipe to install this project on a Linux VPS\n"
        "that already runs 3 Emergent projects on ports 8001, 8002, 8003.\n"
        "This installation uses port 8004 (backend) and port 3005 (sidecar).",
        align="C")
    pdf.ln(30)

    # Info card
    pdf.set_fill_color(*BG_CODE)
    pdf.set_draw_color(*BORDER)
    x0, y0 = 30, pdf.get_y()
    w = PAGE_WIDTH - 60
    pdf.rect(x0, y0, w, 60, "DF")
    pdf.set_xy(x0 + 6, y0 + 6)
    pdf.set_font(F_SANS, "B", 10)
    pdf.set_text_color(*DEEP_TEAL)
    pdf.cell(w - 12, 6, "AT A GLANCE")
    pdf.ln(9)
    pdf.set_font(F_SANS, "", 10)
    pdf.set_text_color(*TEXT)
    pdf.set_x(x0 + 6)
    lines = [
        "Target OS       :  Ubuntu 22.04 / 24.04 LTS",
        "Runtimes         :  Python 3.11 · Node 20 LTS · MongoDB 7",
        "Reverse proxy    :  Nginx + Certbot (HTTPS)",
        "Process manager  :  Supervisor",
        "Ports (this app) :  8004 (FastAPI) · 3005 (Node/Baileys)",
        "Estimated time   :  30–45 minutes",
    ]
    for line in lines:
        pdf.set_x(x0 + 6)
        pdf.cell(w - 12, 6, line)
        pdf.ln(6)


# ---------- Markdown → PDF renderer (small, focused subset) ----------
def is_hr(line: str) -> bool:
    return line.strip() == "---"


def render_inline(pdf: Guide, text: str) -> None:
    """Render a single line honouring **bold**, `code`, links (rendered as text only)."""
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)  # flatten markdown links
    parts = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            pdf.set_font(F_SANS, "B", 10.5)
            pdf.write(6, part[2:-2])
            pdf.set_font(F_SANS, "", 10.5)
        elif part.startswith("`") and part.endswith("`"):
            pdf.set_font(F_MONO, "", 10)
            pdf.set_text_color(*DEEP_TEAL)
            pdf.write(6, part[1:-1])
            pdf.set_text_color(*TEXT)
            pdf.set_font(F_SANS, "", 10.5)
        else:
            pdf.write(6, part)


def render_paragraph(pdf: Guide, text: str) -> None:
    pdf.set_font(F_SANS, "", 10.5)
    pdf.set_text_color(*TEXT)
    render_inline(pdf, text)
    pdf.ln(7)


def render_bullet(pdf: Guide, text: str) -> None:
    pdf.set_font(F_SANS, "", 10.5)
    pdf.set_text_color(*TEXT)
    pdf.set_x(PAGE_MARGIN + 4)
    pdf.set_text_color(*BRAND_GREEN)
    pdf.write(6, "• ")
    pdf.set_text_color(*TEXT)
    render_inline(pdf, text)
    pdf.ln(7)


def render_ordered(pdf: Guide, index: int, text: str) -> None:
    pdf.set_font(F_SANS, "", 10.5)
    pdf.set_x(PAGE_MARGIN + 4)
    pdf.set_text_color(*DEEP_TEAL)
    pdf.write(6, f"{index}. ")
    pdf.set_text_color(*TEXT)
    render_inline(pdf, text)
    pdf.ln(7)


def render_heading(pdf: Guide, level: int, text: str) -> None:
    pdf.ln(3 if level > 1 else 8)
    if level == 1:
        pdf.set_font(F_SANS, "B", 20)
        pdf.set_text_color(*TEXT)
    elif level == 2:
        pdf.set_font(F_SANS, "B", 15)
        pdf.set_text_color(*DEEP_TEAL)
    else:
        pdf.set_font(F_SANS, "B", 12)
        pdf.set_text_color(*TEXT)
    text = re.sub(r"[*`]", "", text)
    pdf.multi_cell(0, 8, text)
    if level == 2:
        pdf.set_draw_color(*BG_TABLE_HEAD)
        pdf.set_line_width(0.6)
        y = pdf.get_y()
        pdf.line(PAGE_MARGIN, y, PAGE_MARGIN + 40, y)
    pdf.ln(2)


def render_code_block(pdf: Guide, lang: str, code_lines: list) -> None:
    pdf.ln(1)
    pdf.set_fill_color(*BG_CODE)
    pdf.set_draw_color(*BORDER)
    pdf.set_font(F_MONO, "", 8.8)
    line_h = 4.6
    padding = 3
    block_h = line_h * len(code_lines) + padding * 2
    # Page break check
    if pdf.get_y() + block_h > pdf.h - 20:
        pdf.add_page()
    x = PAGE_MARGIN
    y = pdf.get_y()
    pdf.rect(x, y, CONTENT_WIDTH, block_h, "DF")
    pdf.set_text_color(*TEXT)
    for i, ln in enumerate(code_lines):
        pdf.set_xy(x + padding, y + padding + i * line_h)
        # Truncate long lines gently rather than wrap ugly
        safe = ln.replace("\t", "    ")
        pdf.cell(CONTENT_WIDTH - 2 * padding, line_h, safe[:110])
    pdf.set_y(y + block_h + 2)
    pdf.set_font(F_SANS, "", 10.5)


def render_table(pdf: Guide, rows: list) -> None:
    if not rows:
        return
    header = rows[0]
    body = rows[2:]  # skip |---|---| separator
    n = len(header)
    col_w = CONTENT_WIDTH / n
    pdf.set_font(F_SANS, "B", 9.5)
    pdf.set_fill_color(*BG_TABLE_HEAD)
    pdf.set_text_color(*DEEP_TEAL)
    pdf.set_draw_color(*BORDER)
    for c in header:
        pdf.cell(col_w, 8, c.strip(), border=1, fill=True)
    pdf.ln(8)
    pdf.set_font(F_SANS, "", 9.5)
    pdf.set_text_color(*TEXT)
    pdf.set_fill_color(255, 255, 255)
    for row in body:
        # Ensure page break room
        if pdf.get_y() + 8 > pdf.h - 20:
            pdf.add_page()
        for c in row:
            txt = re.sub(r"[*`]", "", c.strip())
            pdf.cell(col_w, 7, txt[:60], border=1)
        pdf.ln(7)
    pdf.ln(2)


def parse_and_render(pdf: Guide, md: str) -> None:
    lines = md.split("\n")
    i = 0
    ordered_idx = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        # Skip cover-title h1 (already rendered as cover)
        if line.startswith("# WA_API SaaS"):
            i += 1
            continue
        # Fenced code block
        m_code = re.match(r"^```(\w*)\s*$", line)
        if m_code:
            lang = m_code.group(1)
            i += 1
            code = []
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            render_code_block(pdf, lang, code)
            continue
        # Table
        if line.startswith("| ") and "|" in line and i + 1 < len(lines) and re.match(r"^\| *:?-+", lines[i+1]):
            tbl = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c for c in lines[i].strip().strip("|").split("|")]
                tbl.append(cells)
                i += 1
            render_table(pdf, tbl)
            continue
        # HR
        if is_hr(line):
            pdf.ln(4)
            pdf.set_draw_color(*BG_TABLE_HEAD)
            pdf.set_line_width(0.3)
            pdf.line(PAGE_MARGIN, pdf.get_y(), PAGE_WIDTH - PAGE_MARGIN, pdf.get_y())
            pdf.ln(3)
            i += 1
            continue
        # Headings
        if line.startswith("### "):
            render_heading(pdf, 3, line[4:]); i += 1; continue
        if line.startswith("## "):
            render_heading(pdf, 2, line[3:]); i += 1; continue
        if line.startswith("# "):
            render_heading(pdf, 1, line[2:]); i += 1; continue
        # Blockquote
        if line.startswith(">"):
            text = line.lstrip("> ").strip()
            pdf.set_fill_color(*BG_TABLE_HEAD)
            pdf.set_font(F_SANS, "", 10)
            pdf.set_text_color(*DEEP_TEAL)
            x = PAGE_MARGIN
            y = pdf.get_y()
            # Compute height using multi_cell measurement
            pdf.set_xy(x + 4, y + 3)
            pdf.multi_cell(CONTENT_WIDTH - 8, 6, re.sub(r"[*`]", "", text))
            y2 = pdf.get_y()
            # Draw callout bar
            pdf.set_fill_color(*BRAND_GREEN)
            pdf.rect(x, y, 2, y2 - y + 2, "F")
            pdf.ln(2)
            pdf.set_font(F_SANS, "", 10.5)
            pdf.set_text_color(*TEXT)
            i += 1; continue
        # Ordered list
        m_ord = re.match(r"^(\d+)\.\s+(.*)$", line)
        if m_ord:
            render_ordered(pdf, int(m_ord.group(1)), m_ord.group(2))
            i += 1; continue
        # Bullet
        if line.startswith("- "):
            render_bullet(pdf, line[2:])
            i += 1; continue
        # Blank
        if not line.strip():
            pdf.ln(2); i += 1; continue
        # Regular paragraph — merge consecutive lines
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#|- |\d+\. |>|```|\|)", lines[i]
        ):
            buf.append(lines[i]); i += 1
        render_paragraph(pdf, " ".join(buf))


def build() -> Path:
    md = MD_PATH.read_text(encoding="utf-8")
    pdf = Guide()
    # Register Unicode fonts (needed for em-dash, curly quotes, arrows, ₹ etc.)
    pdf.add_font(F_SANS, "", SANS_REG, uni=True)
    pdf.add_font(F_SANS, "B", SANS_BOLD, uni=True)
    pdf.add_font(F_MONO, "", MONO_REG, uni=True)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN)
    add_cover(pdf)
    pdf.add_page()
    parse_and_render(pdf, md)
    pdf.output(str(OUT_PDF))
    return OUT_PDF


if __name__ == "__main__":
    out = build()
    size_kb = out.stat().st_size / 1024
    print(f"✅ Wrote {out} ({size_kb:.1f} KB)")
