"""Generate the PWA icon set.

The icon is the product in one image: water rising toward a threshold line.
Crossing that line is the single event this whole tool exists to predict, so
the mark says what the app does rather than being decorative.

Palette is the app's own. The water is deliberately blue, outside the IMD
green / amber / orange / red warning scale used everywhere else, so the icon
can never read as a warning state. The threshold line is IMD amber.

Run from the repository root:

    python3 scripts/make_icons.py

Everything is drawn at 4x and downsampled, which is cheaper than fighting
PIL for antialiasing on curves.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"

BASE = (14, 20, 23)        # --base   #0E1417
WATER = (43, 122, 155)     # a blue that is not in the warning palette
WATER_HI = (71, 160, 191)  # crest highlight
AMBER = (227, 177, 44)     # --imd-yellow #E3B12C, the threshold line
RAIN = (147, 166, 174)     # --ink-dim  #93A6AE

SS = 4  # supersample factor


def draw_icon(size: int, *, padding: float = 0.0, rounded: bool = True) -> Image.Image:
    """Draw one icon.

    `padding` insets the artwork as a fraction of the canvas, used for the
    maskable variant where a launcher may crop to a circle covering only the
    central 80%.
    """
    s = size * SS
    # Artwork is drawn edge to edge on an opaque canvas, then clipped to the
    # plate shape at the end. Drawing the water directly onto a rounded
    # rectangle instead would spill square corners out of the bottom of it,
    # because the polygon knows nothing about the corner radius.
    img = Image.new("RGBA", (s, s), (*BASE, 255))
    d = ImageDraw.Draw(img)

    pad = s * padding
    inner = s - 2 * pad

    def px(fx: float, fy: float) -> tuple[float, float]:
        """Fraction of the artwork box to absolute pixels."""
        return pad + fx * inner, pad + fy * inner

    # --- Water body, with a wave crest ---------------------------------
    # The surface height comes from the artwork box so it keeps its relation
    # to the threshold line, but the water itself spans the whole canvas and
    # runs off the bottom edge. Confining it to the padded box instead left
    # it floating as a rectangle in mid-air on the maskable variant.
    crest_y = 0.60          # resting height of the water surface
    amp = 0.035             # wave amplitude
    steps = 96

    def surface(i: int) -> tuple[float, float]:
        fx = i / steps
        fy = crest_y + amp * math.sin(fx * math.pi * 2 - math.pi / 3)
        return fx * s, pad + fy * inner

    crest = [surface(i) for i in range(steps + 1)]
    d.polygon([*crest, (s, s), (0, s)], fill=WATER)

    # A brighter crest line so the surface reads as water, not a block.
    d.line(crest, fill=WATER_HI, width=max(2, int(s * 0.018)), joint="curve")

    # --- Threshold line -------------------------------------------------
    # The level at which this point floods. Water below it is safe, water
    # above it is not, which is the entire model in one horizontal rule.
    ty = 0.42
    x0, y0 = px(0.13, ty)
    x1, _ = px(0.87, ty)
    dash = inner * 0.055
    gap = inner * 0.032
    x = x0
    w = max(2, int(s * 0.016))
    while x < x1:
        d.line([(x, y0), (min(x + dash, x1), y0)], fill=AMBER, width=w)
        x += dash + gap

    # --- Rain ------------------------------------------------------------
    # Slanted, because vertical strokes read as bars rather than rainfall.
    rw = max(2, int(s * 0.017))
    for fx, fy_top, length in ((0.28, 0.13, 0.13), (0.50, 0.08, 0.16), (0.72, 0.15, 0.11)):
        ax, ay = px(fx, fy_top)
        bx, by = px(fx - 0.045, fy_top + length)
        d.line([(ax, ay), (bx, by)], fill=RAIN, width=rw)

    # Clip to the plate. A maskable icon stays square and bleeds to the edge,
    # because the launcher applies its own shape and any corner rounding
    # baked in here would show up as a visible inset inside it.
    if rounded:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255
        )
        img.putalpha(mask)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    written = []
    for size in (192, 512):
        p = OUT / f"icon-{size}.png"
        draw_icon(size).save(p, "PNG")
        written.append(p)

    # Maskable: artwork inset so a circular crop cannot clip the threshold
    # line or the wave, and no rounded corners since the launcher masks it.
    p = OUT / "icon-maskable-512.png"
    draw_icon(512, padding=0.14, rounded=False).save(p, "PNG")
    written.append(p)

    # iOS ignores the manifest icons and uses this one.
    p = OUT / "apple-touch-icon.png"
    draw_icon(180).save(p, "PNG")
    written.append(p)

    for p in written:
        print(f"  {p.relative_to(OUT.parent.parent)}  {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
