"""Subset the Material Symbols Outlined font to the icons used in templates.

Usage (needs `pip install fonttools brotli`):
  python3 scripts/subset-material-symbols.py          write the subset font
  python3 scripts/subset-material-symbols.py --check  fail if a template icon is missing
"""

import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "node_modules/material-symbols/material-symbols-outlined.woff2"
TARGET = ROOT / "src/material-symbols/material-symbols-outlined-subset.woff2"
TEMPLATES = ROOT / "src/app"

ICON_TAG = re.compile(r"<mat-icon\b[^>]*>(.*?)</mat-icon>", re.S)
BINDING = re.compile(r"\{\{(.*?)\}\}", re.S)
QUOTED = re.compile(r"'([a-z0-9_]+)'")
NAME = re.compile(r"[a-z0-9_]+")


def template_icons() -> set[str]:
    names: set[str] = set()
    for html in TEMPLATES.rglob("*.html"):
        for inner in ICON_TAG.findall(html.read_text()):
            if "{{" in inner:
                for expression in BINDING.findall(inner):
                    names.update(QUOTED.findall(expression))
            elif NAME.fullmatch(inner.strip()):
                names.add(inner.strip())
    return names


def ligatures(font: TTFont) -> dict[str, str]:
    glyph_char = {glyph: chr(code) for code, glyph in font.getBestCmap().items()}
    found: dict[str, str] = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            if lookup.LookupType == 7:
                subtable = subtable.ExtSubTable
            for first, entries in getattr(subtable, "ligatures", {}).items():
                for entry in entries:
                    parts = [first, *entry.Component]
                    if all(part in glyph_char for part in parts):
                        found["".join(glyph_char[part] for part in parts)] = entry.LigGlyph
    return found


def build(icons: set[str]) -> None:
    font = TTFont(SOURCE)
    available = ligatures(font)
    missing = sorted(icons - available.keys())
    if missing:
        sys.exit(f"Unknown Material Symbols icons: {', '.join(missing)}")

    letters = {glyph for code, glyph in font.getBestCmap().items() if chr(code) in "abcdefghijklmnopqrstuvwxyz0123456789_"}
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_closure = False
    options.layout_features = ["rlig", "rclt"]
    options.name_IDs = [1, 2]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(glyphs=sorted(letters | {available[name] for name in icons}))
    subsetter.subset(font)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(TARGET)
    print(f"{len(icons)} icons, {TARGET.stat().st_size / 1024:.1f} kB -> {TARGET.relative_to(ROOT)}")


def check(icons: set[str]) -> None:
    shipped = ligatures(TTFont(TARGET)).keys()
    missing = sorted(icons - shipped)
    if missing:
        sys.exit(f"Icons missing from the subset font, run npm run icons:subset: {', '.join(missing)}")
    print(f"Subset font covers all {len(icons)} template icons")


if __name__ == "__main__":
    wanted = template_icons()
    check(wanted) if "--check" in sys.argv else build(wanted)
