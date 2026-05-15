"""
Line dither algorithm — validated Python implementation.
Converts a PIL Image to a line-dithered SVG path string.
"""

import math
import numpy as np
from PIL import Image, ImageEnhance


# ── Bayer matrices ─────────────────────────────────────────────────────────────

BAYER_4 = np.array([
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5,
], dtype=np.float32).reshape(4, 4) / 16.0

BAYER_8 = np.array([
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
], dtype=np.float32).reshape(8, 8) / 64.0


# ── Preprocessing ──────────────────────────────────────────────────────────────

def preprocess(img: Image.Image, max_dim: int = 1200, contrast: float = 1.3) -> np.ndarray:
    """
    Resize (preserving aspect ratio), convert to grayscale, stretch contrast.
    Returns float32 array normalized 0–1.
    """
    img = img.convert("L")

    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    img = ImageEnhance.Contrast(img).enhance(contrast)
    arr = np.array(img, dtype=np.float32) / 255.0

    # Auto-levels
    lo, hi = arr.min(), arr.max()
    if hi > lo:
        arr = (arr - lo) / (hi - lo)

    return arr


# ── Number formatter (SVG-safe, no trailing zeros) ─────────────────────────────

def fmt(n: float) -> str:
    """Format like Figma/clean SVG: integer if whole, else max 2dp, no trailing zeros."""
    rounded = round(n, 2)
    if rounded == int(rounded):
        return str(int(rounded))
    s = f"{rounded:.2f}".rstrip("0")
    return s


# ── Core dither ────────────────────────────────────────────────────────────────

def dither_to_paths(
    lum: np.ndarray,
    row_spacing: int = 5,
    dash_length: float = 3.2,
    min_gap: float = 1.8,
    tilt: float = -0.6,
    mode: str = "floyd",  # "floyd" | "atkinson" | "stucki" | "bayer4" | "bayer8"
) -> tuple[list[list[tuple]], int]:
    """
    Walk each scanline, emit dash coordinates where luminance is dark.

    Returns:
        rows  — list of rows, each row a list of (x1,y1,x2,y2) tuples
        total — total dash count
    """
    h, w = lum.shape
    rows = []
    total = 0

    bayer = BAYER_4 if mode == "bayer4" else BAYER_8

    for row_y in range(row_spacing, h, row_spacing):
        row_lum = lum[row_y]
        dashes = []
        x = 0.0
        err = 0.0
        err2 = 0.0  # Stucki two-step lookahead

        while x < w:
            xi = min(int(x), w - 1)
            x1i = min(xi + math.ceil(dash_length), w - 1)

            slice_ = row_lum[xi:x1i + 1]
            lum_n = float(slice_.mean()) if len(slice_) > 0 else 1.0

            if mode == "floyd":
                adj = max(0.0, min(1.0, lum_n + err))
                place = adj < 0.5
                if place:
                    err = adj
                    x_step = dash_length + min_gap
                else:
                    err = adj - 1.0
                    x_step = dash_length + min_gap + (adj - 0.5) * dash_length * 2.5
            elif mode == "atkinson":
                # Apple Mac classic: only 3/4 of error propagated → sparser, cleaner marks
                adj = max(0.0, min(1.0, lum_n + err))
                place = adj < 0.5
                quant_err = adj if place else adj - 1.0
                err = quant_err * 0.75
                x_step = (dash_length + min_gap if place else
                          dash_length + min_gap + (adj - 0.5) * dash_length * 2.0)
            elif mode == "stucki":
                # Stucki: distributes error over two future positions (8:4 weighting)
                adj = max(0.0, min(1.0, lum_n + err))
                place = adj < 0.5
                quant_err = adj if place else adj - 1.0
                err = err2 + quant_err * (8.0 / 14.0)
                err2 = quant_err * (4.0 / 14.0)
                x_step = dash_length + min_gap
            else:
                bx = xi % bayer.shape[1]
                by = row_y % bayer.shape[0]
                place = lum_n < bayer[by, bx]
                x_step = dash_length + min_gap

            if place and (x + dash_length) <= w:
                dashes.append((x, float(row_y), x + dash_length, float(row_y) + tilt))
                total += 1

            x += x_step

        if dashes:
            rows.append(dashes)

    return rows, total


# ── Gradient helper ────────────────────────────────────────────────────────────

_GRAD_COORDS = {
    "h": ("0%", "0%", "100%", "0%"),
    "v": ("0%", "0%", "0%",   "100%"),
    "d": ("0%", "0%", "100%", "100%"),
}

def _gradient_defs(color1: str, color2: str, direction: str) -> tuple[str, str]:
    """Return (defs_block, paint_server_ref) for a two-stop linear gradient."""
    gx1, gy1, gx2, gy2 = _GRAD_COORDS.get(direction, _GRAD_COORDS["h"])
    defs = (
        f'<defs><linearGradient id="g" x1="{gx1}" y1="{gy1}" x2="{gx2}" y2="{gy2}"'
        f' gradientUnits="objectBoundingBox">'
        f'<stop offset="0%" stop-color="{color1}"/>'
        f'<stop offset="100%" stop-color="{color2}"/>'
        f'</linearGradient></defs>'
    )
    return defs, "url(#g)"


# ── SVG assembly ───────────────────────────────────────────────────────────────

def rows_to_svg(
    rows: list[list[tuple]],
    width: int,
    height: int,
    stroke_color: str = "#131315",
    stroke_width: float = 0.75,
    bg_color: str | None = "#f5f5f0",
    stroke_color2: str | None = None,
    gradient_dir: str = "h",
) -> str:
    parts = []
    for row in rows:
        for x1, y1, x2, y2 in row:
            parts.append(f"M{fmt(x1)} {fmt(y1)}L{fmt(x2)} {fmt(y2)}")

    path_d = "".join(parts)

    bg_rect = (
        f'<rect width="{width}" height="{height}" fill="{bg_color}"/>'
        if bg_color else ""
    )

    if stroke_color2:
        defs, paint = _gradient_defs(stroke_color, stroke_color2, gradient_dir)
    else:
        defs, paint = "", stroke_color

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" fill="none">'
        f"{defs}{bg_rect}"
        f'<path stroke="{paint}" stroke-width="{stroke_width}" '
        f'stroke-linecap="round" d="{path_d}"/>'
        f"</svg>"
    )


# ── Pixel / blockify ──────────────────────────────────────────────────────────

def lum_to_pixel_svg(
    lum: np.ndarray,
    width: int,
    height: int,
    block_size: int,
    stroke_color: str,
    bg_color: str | None,
    stroke_color2: str | None = None,
    gradient_dir: str = "h",
) -> tuple[str, int]:
    """Render image as solid filled blocks (pixellate mode)."""
    if stroke_color2:
        defs, paint = _gradient_defs(stroke_color, stroke_color2, gradient_dir)
    else:
        defs, paint = "", stroke_color

    img_h, img_w = lum.shape
    parts = []
    for y in range(0, img_h, block_size):
        for x in range(0, img_w, block_size):
            bh = min(block_size, img_h - y)
            bw = min(block_size, img_w - x)
            if float(lum[y:y + bh, x:x + bw].mean()) < 0.5:
                parts.append(
                    f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" fill="{paint}"/>'
                )

    bg = f'<rect width="{width}" height="{height}" fill="{bg_color}"/>' if bg_color else ""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'{defs}{bg}{"".join(parts)}</svg>'
    )
    return svg, len(parts)


# ── Top-level entry point ──────────────────────────────────────────────────────

def image_to_svg(
    img: Image.Image,
    row_spacing: int = 5,
    dash_length: float = 3.2,
    min_gap: float = 1.8,
    tilt: float = -0.6,
    contrast: float = 1.3,
    mode: str = "floyd",
    stroke_color: str = "#131315",
    stroke_width: float = 0.75,
    bg_color: str | None = "#f5f5f0",
    max_dim: int = 1200,
    stroke_color2: str | None = None,
    gradient_dir: str = "h",
) -> tuple[str, int, int, int]:
    """
    Full pipeline: PIL Image → SVG string.

    Returns:
        svg_str     — complete SVG document
        width       — output width in px
        height      — output height in px
        dash_count  — total number of dashes rendered
    """
    lum = preprocess(img, max_dim=max_dim, contrast=contrast)
    h, w = lum.shape

    if mode == "pixel":
        svg, dash_count = lum_to_pixel_svg(
            lum, w, h,
            block_size=row_spacing,
            stroke_color=stroke_color,
            bg_color=bg_color,
            stroke_color2=stroke_color2,
            gradient_dir=gradient_dir,
        )
    else:
        rows, dash_count = dither_to_paths(
            lum,
            row_spacing=row_spacing,
            dash_length=dash_length,
            min_gap=min_gap,
            tilt=tilt,
            mode=mode,
        )
        svg = rows_to_svg(
            rows, w, h,
            stroke_color=stroke_color,
            stroke_width=stroke_width,
            bg_color=bg_color,
            stroke_color2=stroke_color2,
            gradient_dir=gradient_dir,
        )

    return svg, w, h, dash_count
