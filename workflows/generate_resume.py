#!/usr/bin/env python3
"""
generate_resume.py
==================
Reads resume.yaml and writes resume.html.

Usage:
    python generate_resume.py

Optional — also export a PDF (requires weasyprint):
    pip install weasyprint
    python generate_resume.py --pdf
"""

import argparse
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML not found. Run: pip install pyyaml")


# ── helpers ──────────────────────────────────────────────────────────────────

def esc(text: str) -> str:
    """Minimal HTML escaping."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def bullets_html(items: list) -> str:
    if not items:
        return ""
    li = "\n".join(f"        <li>{esc(b)}</li>" for b in items)
    return f"      <ul>\n{li}\n      </ul>"


def links_html(links: list) -> str:
    """Render optional link chips below an entry subtitle."""
    if not links:
        return ""
    chips = "\n".join(
        f'        <a href="{esc(lk["url"])}" target="_blank" rel="noopener" '
        f'class="resume-entry-link">{esc(lk["label"])}</a>'
        for lk in links
    )
    return f'      <div class="resume-entry-links">\n{chips}\n      </div>'


def sub_html(text: str, image_src: str = "", image_alt: str = "") -> str:
    """Return subtitle text — plain if no image, or a lightbox trigger if an image is set."""
    if not image_src:
        return esc(text)
    return (
        f'<span class="img-trigger" '
        f'data-src="{esc(image_src)}" '
        f'data-alt="{esc(image_alt)}" '
        f'tabindex="0" role="button" title="Click to view photo">'
        f'{esc(text)}</span>'
    )


# ── section builders ─────────────────────────────────────────────────────────

def build_experience(entries: list) -> str:
    blocks = []
    for e in entries:
        sub = e.get("company", "")
        if e.get("location"):
            sub += f" — {e['location']}"
        blocks.append(f"""
      <div class="resume-entry">
        <div class="resume-entry-header">
          <div class="resume-entry-title">{sub_html(e['title'], e.get('image', ''), e.get('company', ''))}</div>
          <div class="resume-entry-date">{esc(e.get('dates', ''))}</div>
        </div>
        <div class="resume-entry-sub">{esc(sub)}</div>
{links_html(e.get('links', []))}
{bullets_html(e.get('bullets', []))}
      </div>""")
    return "\n".join(blocks)


def build_projects(entries: list) -> str:
    blocks = []
    for p in entries:
        if "heading" in p:
            note = f' <span class="project-year-note">{esc(p["note"])}</span>' if p.get("note") else ""
            blocks.append(f'      <div class="project-year-heading">{esc(p["heading"])}{note}</div>')
            continue
        blocks.append(f"""
      <div class="resume-entry">
        <div class="resume-entry-header">
          <div class="resume-entry-title">{sub_html(p['name'], p.get('image', ''), p.get('name', ''))}</div>
        </div>
        <div class="resume-entry-sub">{esc(p.get('subtitle', ''))}</div>
{links_html(p.get('links', []))}
{bullets_html(p.get('bullets', []))}
      </div>""")
    return "\n".join(blocks)


def build_education(entries: list) -> str:
    blocks = []
    for e in entries:
        sub = e.get("school", "")
        if e.get("location"):
            sub += f" — {e['location']}"
        blocks.append(f"""
      <div class="resume-entry">
        <div class="resume-entry-header">
          <div class="resume-entry-title">{sub_html(e['degree'], e.get('image', ''), e.get('school', ''))}</div>
          <div class="resume-entry-date">{esc(e.get('date', ''))}</div>
        </div>
        <div class="resume-entry-sub">{esc(sub)}</div>
{links_html(e.get('links', []))}
{bullets_html(e.get('bullets', []))}
      </div>""")
    return "\n".join(blocks)


def build_leadership(entries: list) -> str:
    blocks = []
    for e in entries:
        sub = e.get("organization", "")
        if e.get("location"):
            sub += f" — {e['location']}"
        blocks.append(f"""
      <div class="resume-entry">
        <div class="resume-entry-header">
          <div class="resume-entry-title">{sub_html(e['title'], e.get('image', ''), e.get('organization', ''))}</div>
          <div class="resume-entry-date">{esc(e.get('dates', ''))}</div>
        </div>
        <div class="resume-entry-sub">{esc(sub)}</div>
{links_html(e.get('links', []))}
{bullets_html(e.get('bullets', []))}
      </div>""")
    return "\n".join(blocks)


def build_skills(entries: list) -> str:
    categories = []
    for s in entries:
        pills = "".join(
            f'<span class="resume-skill-pill">{esc(item.strip())}</span>'
            for item in s["items"].split(",")
            if item.strip()
        )
        categories.append(
            f'        <div class="resume-skill-category">\n'
            f'          <div class="resume-skill-category-label">{esc(s["category"])}</div>\n'
            f'          <div class="resume-skill-pills">{pills}</div>\n'
            f'        </div>'
        )
    return '      <div class="resume-skills">\n' + "\n".join(categories) + "\n      </div>"


# ── contact row ──────────────────────────────────────────────────────────────

def build_contact(c: dict) -> str:
    parts = []
    if c.get("email"):
        parts.append(f'<a href="mailto:{esc(c["email"])}">{esc(c["email"])}</a>')
    if c.get("website"):
        parts.append(
            f'<a href="{esc(c.get("website_url", c["website"]))}" '
            f'target="_blank" rel="noopener">{esc(c["website"])}</a>'
        )
    if c.get("linkedin"):
        parts.append(
            f'<a href="{esc(c.get("linkedin_url", ""))}" '
            f'target="_blank" rel="noopener">{esc(c["linkedin"])}</a>'
        )
    if c.get("github"):
        parts.append(
            f'<a href="{esc(c.get("github_url", ""))}" '
            f'target="_blank" rel="noopener">{esc(c["github"])}</a>'
        )
    return "\n              ".join(parts)


# ── full HTML template ────────────────────────────────────────────────────────

def render_html(data: dict) -> str:
    name    = esc(data.get("name", "Resume"))
    title   = esc(data.get("title", ""))
    summary = esc(data.get("summary", "").strip())
    contact = build_contact(data.get("contact", {}))
    exp        = build_experience(data.get("experience", []))
    proj       = build_projects(data.get("projects", []))
    edu        = build_education(data.get("education", []))
    skills     = build_skills(data.get("skills", []))
    leadership = build_leadership(data.get("leadership", []))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resume — {name}</title>
  <meta name="description" content="Resume of {name} — {title}.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./css/style.css">
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=UA-175301597-1"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){{dataLayer.push(arguments);}}
    gtag('js', new Date());
    gtag('config', 'UA-175301597-1');
  </script>
</head>
<body>

  <!-- Navbar -->
  <nav class="navbar">
    <div class="container">
      <div class="navbar-inner">
        <a href="index.html" class="navbar-brand">{name}</a>
        <button class="navbar-toggle" id="navToggle" aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </button>
        <ul class="navbar-nav" id="navMenu">
          <li><a href="index.html" class="navbar-link">Home</a></li>
          <li><a href="projects.html" class="navbar-link">Projects</a></li>
          <li><a href="resume.html" class="navbar-link active">Resume</a></li>
          <li><a href="links.html" class="navbar-link">Links</a></li>
          <li><a href="mailto:{esc(data.get('contact', {}).get('email', ''))}" class="navbar-link navbar-cta">Email Me</a></li>
        </ul>
      </div>
    </div>
  </nav>

  <!-- Page Header -->
  <div class="page-header">
    <div class="container">
      <h1>Resume</h1>
      <p>Experience, education, and skills — all in one place.</p>
    </div>
  </div>

  <!-- Resume Content -->
  <section class="section">
    <div class="container">
      <div class="resume-wrapper">

        <!-- Download bar -->
        <div class="resume-download-bar">
          <p>Prefer a PDF? Download a copy of my resume below.</p>
          <a href="./docs/jan-2026.pdf" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PDF
          </a>
        </div>

        <!-- Resume Document -->
        <div class="resume-doc">

          <!-- Header -->
          <div class="resume-header">
            <h1>{name}</h1>
            <div class="title-line">{title}</div>
            <div class="resume-contact">
              {contact}
            </div>
          </div>

          <!-- Summary -->
          <div class="resume-section">
            <div class="resume-section-title">Summary</div>
            <p style="font-size:0.875rem; color:var(--grey-700); line-height:1.7;">
              {summary}
            </p>
          </div>

          <!-- Experience -->
          <div class="resume-section">
            <div class="resume-section-title">Experience</div>
{exp}
          </div>

          <!-- Skills -->
          <div class="resume-section">
            <div class="resume-section-title">Skills</div>
{skills}
          </div>

          <!-- Projects -->
          <div class="resume-section">
            <div class="resume-section-title">Projects</div>
{proj}
          </div>

          <!-- Education -->
          <div class="resume-section">
            <div class="resume-section-title">Education</div>
{edu}
          </div>

          <!-- Leadership -->
          <div class="resume-section">
            <div class="resume-section-title">Leadership</div>
{leadership}
          </div>

        </div>
        <!-- /resume-doc -->

        <!-- Print button -->
        <div style="text-align:center; margin-top:2rem;">
          <button onclick="window.print()" class="btn btn-navy">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print Resume
          </button>
        </div>

      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="container">
      <div class="footer-inner">
        <span class="footer-brand">{name}</span>
        <div class="footer-links">
          <a href="{esc(data.get('contact', {}).get('github_url', '#'))}" target="_blank" rel="noopener">GitHub</a>
          <a href="{esc(data.get('contact', {}).get('linkedin_url', '#'))}" target="_blank" rel="noopener">LinkedIn</a>
          <a href="mailto:{esc(data.get('contact', {}).get('email', ''))}">Email</a>
          <a href="https://buymeacoffee.com/jaceiverson" target="_blank" rel="noopener" class="footer-bmc">☕ Buy me a coffee</a>
        </div>
        <span>&copy; <script>document.write(new Date().getFullYear())</script> {name}</span>
      </div>
    </div>
  </footer>

  <!-- Lightbox -->
  <div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-content">
      <button class="lightbox-close" aria-label="Close photo">&times;</button>
      <img id="lightbox-img" src="" alt="">
      <p id="lightbox-caption" class="lightbox-caption"></p>
    </div>
  </div>

  <script>
    const toggle = document.getElementById('navToggle');
    const menu = document.getElementById('navMenu');
    toggle.addEventListener('click', () => {{
      toggle.classList.toggle('open');
      menu.classList.toggle('open');
    }});

    // Lightbox
    const lightbox  = document.getElementById('lightbox');
    const lbImg     = document.getElementById('lightbox-img');
    const lbCaption = document.getElementById('lightbox-caption');

    function openLightbox(src, alt) {{
      lbImg.src = src;
      lbImg.alt = alt;
      lbCaption.textContent = alt;
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }}

    function closeLightbox() {{
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
      lbImg.src = '';
    }}

    document.querySelectorAll('.img-trigger').forEach(el => {{
      el.addEventListener('click', () => openLightbox(el.dataset.src, el.dataset.alt));
      el.addEventListener('keydown', e => {{ if (e.key === 'Enter' || e.key === ' ') openLightbox(el.dataset.src, el.dataset.alt); }});
    }});

    lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
    lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', e => {{ if (e.key === 'Escape') closeLightbox(); }});
  </script>
</body>
</html>
"""


# ── main ─────────────────────────────────────────────────────────────────────

# Paths are anchored to the script's location so the script works correctly
# regardless of which directory you run it from.
_SCRIPT_DIR  = Path(__file__).parent          # .../workflows/
_PROJECT_DIR = _SCRIPT_DIR.parent             # .../jaceiversonprofile/

def main():
    parser = argparse.ArgumentParser(description="Generate resume.html from resume.yaml")
    parser.add_argument(
        "--yaml", default=str(_SCRIPT_DIR / "resume.yaml"),
        help="Path to resume YAML file (default: workflows/resume.yaml)"
    )
    parser.add_argument(
        "--out", default=str(_PROJECT_DIR / "resume.html"),
        help="Output HTML file path (default: project root resume.html)"
    )
    parser.add_argument(
        "--pdf", action="store_true",
        help="Also generate a PDF via weasyprint (pip install weasyprint)"
    )
    args = parser.parse_args()

    yaml_path = Path(args.yaml)
    out_path  = Path(args.out)

    if not yaml_path.exists():
        sys.exit(f"Error: '{yaml_path}' not found.")

    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    html = render_html(data)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"✓ Written: {out_path}")

    if args.pdf:
        pdf_path = out_path.with_suffix(".pdf")
        try:
            from weasyprint import HTML as WP_HTML
            WP_HTML(filename=str(out_path)).write_pdf(str(pdf_path))
            print(f"✓ PDF written: {pdf_path}")
        except ImportError:
            print("  weasyprint not installed — skipping PDF. Run: pip install weasyprint")
        except Exception as e:
            print(f"  PDF generation failed: {e}")


if __name__ == "__main__":
    main()
