# Video Conversion Plan

Support short videos (< 15 seconds) as input, producing animated line-dithered SVG output.

## Core concept

Every video frame is an image — the existing `image_to_svg` pipeline already handles everything except frame extraction. The work is: extract frames → process each through the existing dither pipeline → assemble into an animated SVG → stream progress back to the UI.

## 1. Frame extraction

Use `ffmpeg` as a subprocess. Avoids a heavy Python dependency (`opencv-python` is ~50 MB), and is trivially added to the `Containerfile`.

```bash
# Extract at 10 fps, max 15 seconds, pipe frames as PNG to stdout
ffmpeg -i input.mp4 -t 15 -vf fps=10 -f image2pipe -vcodec png pipe:1
```

**Target FPS: 10.** 15s × 10fps = 150 frames max. FPS is a locked server constant — not user-configurable.

**Duration validation:** `ffprobe` the file before processing. Reject anything over 15 seconds with a 400 error immediately, before touching frames.

## 2. Processing pipeline

Reuse `image_to_svg` unchanged, once per frame. The only difference is that `max_dim` is capped lower for video (600px vs 1200px for images) to keep per-frame SVG strings short and frame processing fast.

The `pixel` and Bayer modes produce much smaller SVGs per frame than Floyd/Atkinson/Stucki (fewer path commands), which matters at 150 frames. Worth surfacing in UI hint text.

## 3. Output format: animated SVG

Each frame becomes a `<g>` element. SMIL `<set>` toggles visibility at the right timestamps:

```xml
<svg ...>
  <g id="f0">
    <path d="..."/>
    <set attributeName="display" to="none" begin="0.1s" fill="freeze"/>
  </g>
  <g id="f1" display="none">
    <path d="..."/>
    <set attributeName="display" to="inline" begin="0.1s" fill="freeze"/>
    <set attributeName="display" to="none" begin="0.2s" fill="freeze"/>
  </g>
  ...
</svg>
```

This is a single self-contained file the user can open in a browser or embed anywhere — no JS required. The existing `<object>` preview element already renders SVG natively, so the preview works without frontend changes.

**Fallback download options:**
- ZIP of individual SVGs (for users importing frames into other tools)
- GIF via client-side canvas rasterization + a pure-JS encoder (`gif.js`) — low priority

## 4. Progress feedback via Server-Sent Events

150 frames takes 15–60 seconds depending on hardware. A spinner with no progress is unusable at that scale.

**New endpoint:** `POST /dither/video` returns an SSE stream.

```
data: {"status": "extracting", "total": 150}
data: {"status": "frame", "n": 1, "total": 150}
data: {"status": "frame", "n": 2, "total": 150}
...
data: {"status": "done", "svg": "<svg .../>"}
```

The client opens a streaming connection using `fetch` (not `EventSource` — EventSource doesn't support POST). On `done`, the SVG blob is handed off to the existing preview/download machinery.

## 5. Frontend changes

**File input:** Add video MIME types (`video/mp4`, `video/webm`, `video/quicktime`) to the `accept` attribute and the client-side type allowlist. Detect video by MIME and branch to the video upload path.

**Progress bar:** Replace the spinner with a labeled progress bar (`frame N of 150`) during video processing. Reuse the existing status bar for short messages.

**Controls:** All existing controls pass through unchanged. No controls need to be hidden for video mode.

**Download:** Animated SVG is the primary download. ZIP of frames comes later.

## 6. New dependencies

| What | How |
|---|---|
| `ffmpeg` binary | `RUN apt-get install -y ffmpeg` in `Containerfile` |
| `ffprobe` | Bundled with ffmpeg |
| No new Python packages | Subprocess call; PIL already handles PNG frame bytes |

## 7. What stays unchanged

- `dither.py` — untouched
- `image_to_svg` — called once per frame, no modifications
- Existing `POST /dither` endpoint — images continue to work exactly as before
- `index.html` preview `<object>` — animated SVG renders natively

## Risks

**SVG file size.** 150 frames of Floyd-Steinberg at 600px can produce 20–50 MB animated SVGs. The pixel/Bayer modes are 5–10× smaller. Show an estimated frame count and file-size warning in the UI before processing starts.

**ffmpeg availability.** If the base Python image doesn't include ffmpeg, the `Containerfile` build step adds it — validate this early in implementation.

**SMIL browser support.** Chrome has discussed deprecating SMIL for years but has not shipped that change. All current browsers render SMIL SVG animation correctly. If this becomes an issue, the fallback is client-side JS frame cycling using the ZIP-of-frames output.

## Implementation order

1. Backend: `ffprobe` duration check + `ffmpeg` frame extraction + `/dither/video` SSE endpoint
2. Frontend: progress bar UI + video file detection + streaming fetch
3. Animated SVG assembly in `dither.py` or a new `animate.py`
4. Download options (animated SVG first, ZIP later)
