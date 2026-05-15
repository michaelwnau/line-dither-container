"""
Line Dither - Flask server
GET  /          -> UI
POST /dither    -> multipart image upload, returns SVG inline
GET  /health    -> 200 OK
GET  /debug     -> echo request details (remove before prod)
"""

import io
import os

from flask import Flask, request, Response, jsonify, send_file
from PIL import Image

from dither import image_to_svg

app = Flask(__name__)
# Disable content-length enforcement — let Werkzeug buffer everything
app.config["MAX_CONTENT_LENGTH"] = None


def clamp(val, lo, hi):
    return max(lo, min(hi, val))


def parse_params(form):
    def f(key, default, lo, hi, cast=float):
        try:
            return clamp(cast(form.get(key, default)), lo, hi)
        except (TypeError, ValueError):
            return cast(default)

    mode = form.get("mode", "floyd")
    if mode not in ("floyd", "atkinson", "stucki", "bayer4", "bayer8", "pixel"):
        mode = "floyd"

    stroke_color = form.get("stroke_color", "#131315").strip()
    if not stroke_color.startswith("#") or len(stroke_color) not in (4, 7):
        stroke_color = "#131315"

    bg_color = form.get("bg_color", "#f5f5f0").strip()
    if bg_color.lower() in ("none", "transparent", ""):
        bg_color = None
    elif not bg_color.startswith("#") or len(bg_color) not in (4, 7):
        bg_color = "#f5f5f0"

    stroke_color2 = form.get("stroke_color2", "").strip()
    if not stroke_color2 or not stroke_color2.startswith("#") or len(stroke_color2) not in (4, 7):
        stroke_color2 = None

    gradient_dir = form.get("gradient_dir", "h")
    if gradient_dir not in ("h", "v", "d"):
        gradient_dir = "h"

    return {
        "row_spacing":  f("row_spacing",  5,    2,   20, int),
        "dash_length":  f("dash_length",  3.2,  0.5, 20.0),
        "min_gap":      f("min_gap",      1.8,  0.2, 20.0),
        "tilt":         f("tilt",        -0.6, -6.0,  6.0),
        "contrast":     f("contrast",     1.3,  0.3,  4.0),
        "stroke_width": f("stroke_width", 0.75, 0.1,  5.0),
        "max_dim":      f("max_dim",      1200, 100, 4000, int),
        "mode":          mode,
        "stroke_color":  stroke_color,
        "bg_color":      bg_color,
        "stroke_color2": stroke_color2,
        "gradient_dir":  gradient_dir,
    }


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Expose-Headers"] = (
        "X-Dash-Count, X-Width, X-Height, X-Error"
    )
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/")
def index():
    return send_file(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"),
        mimetype="text/html",
    )


@app.route("/debug", methods=["GET", "POST"])
def debug():
    """Diagnostic endpoint — shows exactly what the server receives."""
    info = {
        "method": request.method,
        "content_type": request.content_type,
        "content_length": request.content_length,
        "files": {},
        "form_keys": list(request.form.keys()),
    }
    for key, f in request.files.items():
        raw = f.read()
        info["files"][key] = {
            "filename": f.filename,
            "content_type": f.content_type,
            "bytes": len(raw),
            "first_16_hex": raw[:16].hex() if raw else "(empty)",
        }
    return jsonify(info)


@app.post("/dither")
def dither():
    if "image" not in request.files:
        return jsonify({"error": "No 'image' field — fields received: "
                        + str(list(request.files.keys()))}), 400

    file = request.files["image"]

    # Read the stream into memory first
    raw = file.stream.read()

    app.logger.info(
        "Upload: filename=%r content_type=%r bytes=%d",
        file.filename, file.content_type, len(raw),
    )

    if len(raw) == 0:
        return jsonify({"error": "File uploaded with 0 bytes. "
                        "Check browser devtools Network tab for request size."}), 400

    # Reject SVG before Pillow sees it (Pillow cannot open SVG)
    if raw[:4].lstrip(b'\xef\xbb\xbf').startswith(b'<'):
        return jsonify({
            "error": "SVG files cannot be used as input. "
                     "Upload a raster image: JPEG, PNG, or WebP."
        }), 415

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
        img = img.convert("RGB")
    except Exception as e:
        app.logger.error(
            "Pillow failed: %s | first bytes: %s", e, raw[:16].hex()
        )
        return jsonify({
            "error": f"Could not open image: {e}",
            "hint": f"Received {len(raw)} bytes, first 16 hex: {raw[:16].hex()}",
        }), 422

    params = parse_params(request.form)

    try:
        svg, width, height, dash_count = image_to_svg(img, **params)
    except Exception as e:
        app.logger.exception("Dither failed")
        return jsonify({"error": f"Dither failed: {e}"}), 500

    resp = Response(svg, status=200, mimetype="image/svg+xml")
    resp.headers["X-Dash-Count"] = str(dash_count)
    resp.headers["X-Width"] = str(width)
    resp.headers["X-Height"] = str(height)
    return resp


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
