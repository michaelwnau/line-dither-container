/**
 * Line dither algorithm — TypeScript implementation.
 * Ported from dither.py for client-side execution.
 */

export interface DitherParams {
  row_spacing: number;
  dash_length: number;
  min_gap: number;
  tilt: number;
  contrast: number;
  mode: string;
  stroke_color: string;
  stroke_width: number;
  bg_color: string | null;
  max_dim: number;
  stroke_color2?: string;
  gradient_dir?: string;
}

export interface DitherResult {
  svg: string;
  width: number;
  height: number;
  dashCount: number;
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map(row => row.map(v => v / 16.0));

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
].map(row => row.map(v => v / 64.0));

const GRAD_COORDS: Record<string, [string, string, string, string]> = {
  "h": ["0%", "0%", "100%", "0%"],
  "v": ["0%", "0%", "0%", "100%"],
  "d": ["0%", "0%", "100%", "100%"],
};

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (rounded === Math.floor(rounded)) return rounded.toString();
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

function getLuminance(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
  const r = data[idx] / 255;
  const g = data[idx + 1] / 255;
  const b = data[idx + 2] / 255;
  // Standard luminance weights
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function imageToSvg(img: HTMLImageElement, params: DitherParams): Promise<DitherResult> {
  const { max_dim, contrast, row_spacing, dash_length, min_gap, tilt, mode, stroke_color, stroke_width, bg_color, stroke_color2, gradient_dir } = params;

  // 1. Resize and prepare canvas
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > max_dim) {
    const scale = max_dim / Math.max(w, h);
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;

  // 2. Preprocess (Contrast)
  // Note: We use a float-based contrast on our luminance extraction in the dither loop.

  // 3. Dither to paths
  const rows: [number, number, number, number][][] = [];
  let totalDashes = 0;
  const bayer = mode === "bayer4" ? BAYER_4 : BAYER_8;

  for (let rowY = row_spacing; rowY < h; rowY += row_spacing) {
    const dashes: [number, number, number, number][] = [];
    let x = 0;
    let err = 0;
    let err2 = 0;

    while (x < w) {
      const xi = Math.min(Math.floor(x), w - 1);
      const x1i = Math.min(xi + Math.ceil(dash_length), w - 1);
      
      // Local luminance mean
      let sum = 0;
      let count = 0;
      for (let i = xi; i <= x1i; i++) {
        sum += getLuminance(pixels, i, rowY, w);
        count++;
      }
      let lumN = count > 0 ? sum / count : 1.0;

      // Apply contrast roughly
      lumN = Math.max(0, Math.min(1, (lumN - 0.5) * contrast + 0.5));

      let place = false;
      let xStep = dash_length + min_gap;

      if (mode === "floyd") {
        const adj = Math.max(0, Math.min(1, lumN + err));
        place = adj < 0.5;
        if (place) {
          err = adj;
        } else {
          err = adj - 1.0;
          xStep += (adj - 0.5) * dash_length * 2.5;
        }
      } else if (mode === "atkinson") {
        const adj = Math.max(0, Math.min(1, lumN + err));
        place = adj < 0.5;
        const quantErr = place ? adj : adj - 1.0;
        err = quantErr * 0.75;
        if (!place) {
          xStep += (adj - 0.5) * dash_length * 2.0;
        }
      } else if (mode === "stucki") {
        const adj = Math.max(0, Math.min(1, lumN + err));
        place = adj < 0.5;
        const quantErr = place ? adj : adj - 1.0;
        err = err2 + quantErr * (8.0 / 14.0);
        err2 = quantErr * (4.0 / 14.0);
      } else if (mode === "pixel") {
        place = lumN < 0.5;
      } else {
        const bx = xi % bayer[0].length;
        const by = rowY % bayer.length;
        place = lumN < bayer[by][bx];
      }

      if (place && (x + dash_length) <= w) {
        dashes.push([x, rowY, x + dash_length, rowY + tilt]);
        totalDashes++;
      }
      x += xStep;
    }
    if (dashes.length > 0) rows.push(dashes);
  }

  // 4. Assemble SVG
  let pathD = "";
  if (mode === "pixel") {
    // Pixel mode assembly
    const parts: string[] = [];
    const blockSize = row_spacing;
    for (let y = 0; y < h; y += blockSize) {
      for (let x = 0; x < w; x += blockSize) {
        let sum = 0, count = 0;
        for (let dy = 0; dy < Math.min(blockSize, h - y); dy++) {
          for (let dx = 0; dx < Math.min(blockSize, w - x); dx++) {
            sum += getLuminance(pixels, x + dx, y + dy, w);
            count++;
          }
        }
        const lumN = count > 0 ? sum / count : 1.0;
        const adj = Math.max(0, Math.min(1, (lumN - 0.5) * contrast + 0.5));
        if (adj < 0.5) {
          parts.push(`<rect x="${x}" y="${y}" width="${Math.min(blockSize, w - x)}" height="${Math.min(blockSize, h - y)}" fill="currentColor"/>`);
        }
      }
    }
    
    const bgRect = bg_color && bg_color !== 'none' ? `<rect width="${w}" height="${h}" fill="${bg_color}"/>` : "";
    let defs = "";
    let paint = stroke_color;
    if (stroke_color2) {
      const [gx1, gy1, gx2, gy2] = GRAD_COORDS[gradient_dir || "h"];
      defs = `<defs><linearGradient id="g" x1="${gx1}" y1="${gy1}" x2="${gx2}" y2="${gy2}" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${stroke_color}"/><stop offset="100%" stop-color="${stroke_color2}"/></linearGradient></defs>`;
      paint = "url(#g)";
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${bgRect}<g fill="${paint}">${parts.join("")}</g></svg>`;
    return { svg, width: w, height: h, dashCount: parts.length };
  } else {
    // Path mode assembly
    const parts: string[] = [];
    for (const row of rows) {
      for (const [x1, y1, x2, y2] of row) {
        parts.push(`M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`);
      }
    }
    pathD = parts.join("");

    const bgRect = bg_color && bg_color !== 'none' ? `<rect width="${w}" height="${h}" fill="${bg_color}"/>` : "";
    let defs = "";
    let paint = stroke_color;
    if (stroke_color2) {
      const [gx1, gy1, gx2, gy2] = GRAD_COORDS[gradient_dir || "h"];
      defs = `<defs><linearGradient id="g" x1="${gx1}" y1="${gy1}" x2="${gx2}" y2="${gy2}" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="${stroke_color}"/><stop offset="100%" stop-color="${stroke_color2}"/></linearGradient></defs>`;
      paint = "url(#g)";
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">${defs}${bgRect}<path stroke="${paint}" stroke-width="${stroke_width}" stroke-linecap="round" d="${pathD}"/></svg>`;
    return { svg, width: w, height: h, dashCount: totalDashes };
  }
}
