#!/usr/bin/env python3
"""Build the vector glyph data in site/glyphs.js from font outlines.

The sign and point glyphs are extracted from the DejaVu Sans outlines
(the font is freely licensed; see the header in site/glyphs.js), so the
shapes are the standard forms rather than approximations. Each glyph's
outline is normalized into the 0..100 grid glyphs.js renders on: the
glyph's own bounding box is fitted into the grid with a small margin,
aspect preserved, y flipped to screen coordinates.

Usage: python3 data/build_glyphs.py [path-to-DejaVuSans.ttf]
Rewrites the marked generated block in site/glyphs.js in place.
"""
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

FONT_PATH = sys.argv[1] if len(sys.argv) > 1 else \
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
GLYPHS_JS = "site/glyphs.js"
MARGIN = 3.0  # grid units of padding around each fitted glyph

SIGNS = list(range(0x2648, 0x2654))  # Aries .. Pisces
BODIES = [("sun", 0x2609), ("moon", 0x263D), ("mercury", 0x263F),
          ("venus", 0x2640), ("mars", 0x2642), ("jupiter", 0x2643),
          ("saturn", 0x2644), ("uranus", 0x2645), ("neptune", 0x2646),
          ("pluto", 0x2647), ("true-node", 0x260A), ("south-node", 0x260B)]


def glyph_path(font, glyph_set, cp):
    """One glyph's outline as an SVG path string on the 0..100 grid."""
    name = font.getBestCmap()[cp]
    glyph = glyph_set[name]
    bp = BoundsPen(glyph_set)
    glyph.draw(bp)
    x0, y0, x1, y1 = bp.bounds
    s = (100 - 2 * MARGIN) / max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # x' = s*x + (50 - s*cx);  y' = -s*y + (50 + s*cy)  (flip to screen y)
    pen = SVGPathPen(glyph_set)
    glyph.draw(TransformPen(pen, (s, 0, 0, -s, 50 - s * cx, 50 + s * cy)))
    d = pen.getCommands()
    # Round to 1 decimal and compact: drop spaces after command letters.
    d = re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.1f}", d)
    d = re.sub(r"([A-Za-z]) ", r"\1", d)
    return d


def main():
    font = TTFont(FONT_PATH)
    glyph_set = font.getGlyphSet()
    sign_lines = ",\n".join(f"  '{glyph_path(font, glyph_set, cp)}'"
                            for cp in SIGNS)
    body_lines = ",\n".join(f"  '{key}': '{glyph_path(font, glyph_set, cp)}'"
                            for key, cp in BODIES)
    block = ("/* BEGIN GENERATED GLYPH DATA (data/build_glyphs.py) */\n"
             f"export const SIGN_PATHS = [\n{sign_lines},\n];\n\n"
             f"export const BODY_PATHS = {{\n{body_lines},\n}};\n"
             "/* END GENERATED GLYPH DATA */")
    src = open(GLYPHS_JS).read()
    pat = re.compile(r"/\* BEGIN GENERATED GLYPH DATA.*?/\* END GENERATED GLYPH DATA \*/",
                     re.S)
    assert pat.search(src), "generated block markers not found in glyphs.js"
    open(GLYPHS_JS, "w").write(pat.sub(lambda m: block, src, count=1))
    print(f"glyph data rebuilt from {FONT_PATH}")


if __name__ == "__main__":
    main()
