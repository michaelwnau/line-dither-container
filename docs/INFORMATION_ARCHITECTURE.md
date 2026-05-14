# Linea - Information Architecture

Linea is a web-based application that converts raster images (JPEG, PNG, WebP) into line-dithered SVG graphics. It uses various dithering algorithms and allows real-time adjustment of scanline and image parameters.

## 1. System Overview

- **Backend**: Flask (Python)
- **Frontend**: Vanilla HTML5/CSS3/JavaScript (Single Page Application)
- **Image Processing**: Pillow (PIL) + Custom Dithering Engine
- **Containerization**: Podman/Docker (Containerfile)

---

## 2. Page & Routing Architecture

### 2.1 Web Routes
- **`/` (Home)**: The main entry point. Serves `index.html`.
- **`/health`**: Returns `{"status": "ok"}`. Used for container health checks.
- **`/debug`**: Diagnostic endpoint that echoes request details and file upload metadata.

### 2.2 Core API Endpoint
- **`POST /dither`**:
    - **Description**: Receives an image and parameters, processes it, and returns an SVG.
    - **Request Type**: `multipart/form-data`
    - **Payload**:
        - `image`: The source image file.
        - `row_spacing`: Vertical gap between lines.
        - `dash_length`: Individual stroke length.
        - `min_gap`: Minimum spacing between strokes.
        - `tilt`: Y-offset for strokes.
        - `contrast`: Pre-processing contrast boost.
        - `max_dim`: Maximum dimension for resizing.
        - `mode`: Dithering algorithm (floyd, bayer4, bayer8, atkinson, stucki, pixel).
        - `stroke_color`: Hex color for lines.
        - `bg_color`: Hex color or 'none' for background.

---

## 3. UI Components (Frontend)

### 3.1 Layout
The application uses a grid-based layout with a fixed sidebar for controls and a flexible main area for the preview.

### 3.2 Component Breakdown
- **Header**: Contains the application title ("Linea") and a status indicator (idle, rendering, success, error).
- **Sidebar (Controls)**:
    - **File Drop Zone**: Drag-and-drop or file browser for image selection.
    - **Scanline Controls**: Sliders for `row spacing`, `dash length`, `min gap`, and `tilt`.
    - **Image Processing**: Sliders for `contrast` and `max dim` (resolution).
    - **Algorithm Selector**: Segmented buttons to choose the dithering engine.
    - **Appearance**:
        - `stroke weight`: Line thickness.
        - `stroke color`: Color picker and hex input for the lines.
        - `gradient`: Optional second color and direction (H, V, Diagonal).
        - `background`: Color picker and hex input, with a "none" toggle for transparency.
    - **Action Buttons**:
        - `Render`: Manually trigger a dither (though most params auto-render).
        - `Download`: Split button for SVG (default) or export to PNG/JPEG/WebP.
    - **Stats Panel**: Displays dash count, file size, and SVG dimensions.
- **Main Area**:
    - **Empty State**: Decorative dot grid shown before an image is loaded.
    - **Preview**: SVG object container.
    - **Loading Overlay**: Spinner shown during the dithering process.

---

## 4. Data Flow

1. **User Upload**: User drops an image into the sidebar.
2. **State Management**: Frontend stores the image and parameters.
3. **Request**: On change, the frontend debounces and sends a `POST /dither` request with current parameters.
4. **Processing**: Backend receives the image, applies contrast/resize, performs dithering, and generates SVG paths.
5. **Response**: Backend returns SVG data with custom headers for dash count and dimensions.
6. **Rendering**: Frontend updates the preview and stats panel.

---

## 5. File Structure Reference

- `/docs/`: Documentation (IA, Guides).
- `app.py`: Flask server and API logic.
- `dither.py`: Core algorithm implementation.
- `index.html`: Unified frontend code.
- `requirements.txt`: Python dependencies.
- `Containerfile`: Deployment configuration.
