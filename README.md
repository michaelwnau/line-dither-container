# Linea

Converts any image into a line-dithered SVG. Floyd-Steinberg or Bayer ordered dithering. Served as a local web app.

## Quick start

```powershell
# From the project root (where Containerfile lives)
cd line-dither-container

podman build -t line-dither .
podman run --rm -p 5000:5000 line-dither
```

Then open http://localhost:5000

## File layout

```
line-dither-container/
├── docs/           # Documentation (IA, etc.)
├── Containerfile   # Podman/Docker build spec
├── requirements.txt
├── dither.py       # Core algorithm (no Flask dependencies)
├── app.py          # Flask server & API
├── index.html      # Self-contained UI
└── README.md
```

## Documentation

Comprehensive system details can be found in the [Information Architecture](docs/INFORMATION_ARCHITECTURE.md) file.

## Parameters

| Field | Default | Range | Description |
|---|---|---|---|
| `row_spacing` | 5 | 2–20 | Vertical gap between scanlines (px) |
| `dash_length` | 3.2 | 0.5–20 | Length of each stroke (px) |
| `min_gap` | 1.8 | 0.2–20 | Minimum gap between dashes |
| `tilt` | -0.6 | -6 to 6 | Y-offset at end of each dash |
| `contrast` | 1.3 | 0.3–4 | Pre-processing contrast multiplier |
| `stroke_width` | 0.75 | 0.1–5 | SVG stroke-width |
| `max_dim` | 1200 | 100–4000 | Resize longest edge before dithering |
| `mode` | floyd | floyd / bayer4 / bayer8 | Dither algorithm |
| `stroke_color` | #131315 | hex | Stroke color |
| `bg_color` | #f5f5f0 | hex / none | Background rect fill |

## API

```bash
curl -X POST http://localhost:5000/dither \
  -F "image=@photo.jpg" \
  -F "row_spacing=4" \
  -F "mode=floyd" \
  -F "stroke_color=#131315" \
  -o output.svg

curl http://localhost:5000/health
```

## Aaru-style settings

```
row_spacing=4  dash_length=3.2  min_gap=1.8  tilt=-0.62
contrast=1.3   stroke_width=0.75  mode=floyd
stroke_color=#131315  bg_color=none
```

## Dev (no container)

```bash
pip install -r requirements.txt
python app.py
```

## Development & Testing with LM Studio & MCP

To develop and test Linea using **LM Studio** and **MCP**, follow these steps:

1. **Configure MCP**: Use `mcp_config.json` to define MCP server settings (e.g., `filesystem`, `lm-studio`). This file specifies backend services for model loading and inference.
2. **LM Studio Integration**: Ensure LM Studio is running with the required models. Linea leverages it for local LLM execution via the configured MCP servers.
3. **Information Architecture**: Refer to the [Information Architecture document](docs/INFORMATION_ARCHITECTURE.md) in the `docs/` directory for project structure, API definitions, and component overviews.
