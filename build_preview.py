#!/usr/bin/env python3
"""Builds preview_v2.html — the single-file bundle passed to the Artifact
tool — from index.html/styles.css/data.js/app.js. Run from the project
directory: `python3 build_preview.py`.

Handles the Google Fonts @import correctly: the import URL itself can
contain literal ';' characters (Google's wght@400;500;600;700 syntax), so
a naive "strip up to the first semicolon" regex truncates the URL and
corrupts the rest of the stylesheet. This finds the real end of the
@import statement (the closing quote + parenthesis + semicolon) and moves
the URL into a proper <link rel="stylesheet"> tag instead, since Artifact
publishes don't reliably run @import from an inline <style> block.
"""
import re

TITLE = "State 3929 — Combat Analytics"

with open("styles.css") as f:
    css = f.read()

m = re.search(r"@import\s+url\((['\"])(.*?)\1\)\s*;\s*", css)
font_link = ""
if m:
    font_link = f'<link rel="stylesheet" href="{m.group(2)}">'
    css = css[: m.start()] + css[m.end() :]

with open("data.js") as f:
    data_js = f.read()
with open("i18n.js") as f:
    i18n_js = f.read()
with open("card-art.js") as f:
    card_art_js = f.read()
with open("app.js") as f:
    app_js = f.read()

out = f"""<title>{TITLE}</title>
{font_link}
<style>
{css}
</style>
<div id="shell"></div>
<script>
{data_js}
</script>
<script>
{i18n_js}
</script>
<script>
{card_art_js}
</script>
<script>
{app_js}
</script>
"""

with open("preview_v2.html", "w") as f:
    f.write(out)

print(f"wrote preview_v2.html ({len(out)} bytes, font_link={'yes' if font_link else 'NO — check styles.css'})")
