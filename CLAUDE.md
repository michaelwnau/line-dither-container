# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A containerized Flask web app that converts raster images (JPEG, PNG, WebP) into line-dithered SVGs. It serves a flat single-page UI and exposes a `POST /dither` API endpoint.

## Running locally (no container)

```bash
pip install -r requirements.txt
python app.py
```

App runs on http://localhost:5000. Set `PORT` or `DEBUG=1` via environment variables.

## Container workflow

```powershell
podman build -t line-dither .
podman run --rm -p 5000:5000 line-dither
```

The container uses gunicorn with 2 workers and a 120s timeout. The `Containerfile` (not `Dockerfile`) is the build spec.

## API

```bash
# Convert an image
curl -X POST http://localhost:5000/dither \
  -F "image=@photo.jpg" \
  -F "row_spacing=4" \
  -F "mode=floyd" \
  -o output.svg

# Health check
curl http://localhost:5000/health

# Debug request echo (dev only — remove before prod)
curl http://localhost:5000/debug
```

Response headers carry metadata: `X-Dash-Count`, `X-Width`, `X-Height`.

## Code architecture

**`dither.py`** — pure algorithm, no Flask dependency. Pipeline:
1. `preprocess()` — resize to `max_dim`, grayscale, contrast enhance, auto-levels → `float32` array [0,1]
2. `dither_to_paths()` — scanline walk emitting `(x1,y1,x2,y2)` dash tuples using Floyd-Steinberg error diffusion (`floyd`) or Bayer ordered dithering (`bayer4`/`bayer8`)
3. `rows_to_svg()` — assembles all dashes into a single `<path d="...">` element
4. `image_to_svg()` — top-level entry point combining all three steps; returns `(svg_str, width, height, dash_count)`

**`app.py`** — Flask server. `parse_params()` validates and clamps all form fields before passing to `image_to_svg()`. SVG input is explicitly rejected (Pillow can't open SVGs). CORS headers are added globally via `@after_request`.

**`index.html`** — flat, self-contained UI with no build step. Served directly by Flask's `send_file`.

## Key constraints

- All dashes in the output share a single `<path>` element — no per-dash SVG elements.
- `dither.py` must remain importable without Flask so it can be tested or used standalone.
- The `fmt()` helper in `dither.py` keeps SVG coordinate strings compact (no trailing zeros, integers when whole).
- `MAX_CONTENT_LENGTH = None` is intentional — Werkzeug buffers the full upload before Flask sees it.
