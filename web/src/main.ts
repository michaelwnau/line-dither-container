import './style.css'
import { imageToSvg, type DitherParams } from './dither'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── State ──────────────────────────────────────────────────────────────────
interface AppState {
  image: HTMLImageElement | null;
  fileName: string | null;
  svgText: string | null;
  svgBlob: Blob | null;
  debounce: number | null;
  busy: boolean;
  mode: string;
  bgNone: boolean;
  gradOn: boolean;
  gradColor: string;
  gradDir: string;
  fmt: string;
  svgW: number;
  svgH: number;
}

const state: AppState = {
  image: null,
  fileName: null,
  svgText: null,
  svgBlob: null,
  debounce: null,
  busy: false,
  mode: 'floyd',
  bgNone: false,
  gradOn: false,
  gradColor: '#888888',
  gradDir: 'h',
  fmt: 'svg',
  svgW: 0,
  svgH: 0,
};

// ── Initialization ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupDecorativeGrid();
  setupBindings();
});

function setupDecorativeGrid() {
  const ops = [1, .2, .8, .1, .3, 1, .2, .9, .9, .1, 1, .3, .3, 1, .2, .8, .2, .7, .8, .1, .7, .5, 1, .2, 1, .1, .7, .8, .4, .3, .4, .6, .3, 1, .1, .8, .1, .6, .3, .9, .8, .2, 1, .3, .9, .1, .4, .3, .4, .7, .6, .2, .8, .1, .9, .2, .5, .4, .3, .2, .4, .7, .2, .8, .1, .9, .2, .4, .3, .8, .7, .1, .6, .2, .5, .1, .8, .3, .4, .7, .9, .1, .5, .3, .7, .2, .6, .4, .3, .5];
  const frag = document.createDocumentFragment();
  ops.forEach(() => {
    const s = document.createElement('span');
    const dur = (3.5 + Math.random() * 4).toFixed(2);
    s.style.setProperty('--dur', dur + 's');
    s.style.animationDelay = (-Math.random() * parseFloat(dur)).toFixed(2) + 's';
    frag.appendChild(s);
  });
  document.querySelector('.empty-grid')?.appendChild(frag);
}

function setupBindings() {
  // Slider bindings
  bindSlider('s-rs', 'v-rs');
  bindSlider('s-dl', 'v-dl');
  bindSlider('s-mg', 'v-mg');
  bindSlider('s-tl', 'v-tl');
  bindSlider('s-ct', 'v-ct');
  bindSlider('s-md', 'v-md');
  bindSlider('s-sw', 'v-sw');

  // Algorithm segmented control
  $('mode-seg-wrap').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button[data-v]') as HTMLButtonElement;
    if (!btn) return;
    document.querySelectorAll('#mode-seg-wrap button').forEach(b => {
      b.classList.remove('on');
      b.classList.add('bg-transparent', 'text-muted');
      b.classList.remove('bg-surface2', 'text-text');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('on', 'bg-surface2', 'text-text');
    btn.classList.remove('bg-transparent', 'text-muted');
    btn.setAttribute('aria-pressed', 'true');
    state.mode = btn.dataset.v!;
    schedule();
  });

  // Color bindings
  bindColor('cp-stroke', 'hex-stroke', 'sw-stroke');
  bindColor('cp-bg', 'hex-bg', 'sw-bg');

  $('bg-none').addEventListener('change', e => {
    state.bgNone = (e.target as HTMLInputElement).checked;
    ($('cp-bg') as HTMLInputElement).disabled = state.bgNone;
    ($('hex-bg') as HTMLInputElement).disabled = state.bgNone;
    schedule();
  });

  // Gradient controls
  const cpGrad = $('cp-grad') as HTMLInputElement;
  const hxGrad = $('hex-grad') as HTMLInputElement;
  const swGrad = $('sw-grad');

  cpGrad.addEventListener('input', () => {
    hxGrad.value = cpGrad.value.toUpperCase();
    swGrad.style.background = cpGrad.value;
    state.gradColor = hxGrad.value;
    schedule();
  });
  hxGrad.addEventListener('change', () => {
    let v = hxGrad.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      cpGrad.value = v;
      swGrad.style.background = v;
      hxGrad.value = v.toUpperCase();
      state.gradColor = hxGrad.value;
      schedule();
    }
  });

  $('grad-on').addEventListener('change', e => {
    state.gradOn = (e.target as HTMLInputElement).checked;
    cpGrad.disabled = !state.gradOn;
    hxGrad.disabled = !state.gradOn;
    swGrad.style.opacity = state.gradOn ? '1' : '0.4';
    $('grad-dir-seg').style.display = state.gradOn ? 'flex' : 'none';
    schedule();
  });

  $('grad-dir-seg').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button[data-d]') as HTMLButtonElement;
    if (!btn) return;
    document.querySelectorAll('#grad-dir-seg button').forEach(b => {
      b.classList.remove('on', 'bg-surface2', 'text-text');
      b.classList.add('bg-transparent', 'text-muted');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('on', 'bg-surface2', 'text-text');
    btn.classList.remove('bg-transparent', 'text-muted');
    btn.setAttribute('aria-pressed', 'true');
    state.gradDir = btn.dataset.d!;
    schedule();
  });

  // File input
  const dz = $('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over', 'border-border', 'bg-surface2', 'text-text'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over', 'border-border', 'bg-surface2', 'text-text'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over', 'border-border', 'bg-surface2', 'text-text');
    const f = e.dataTransfer?.files[0];
    if (f) setFile(f);
  });
  $('file-input').addEventListener('change', e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) setFile(f);
  });

  // Actions
  $('btn-render').addEventListener('click', render);
  $('btn-dl').addEventListener('click', () => downloadAs(state.fmt));

  const dlMenu = $('dl-menu');
  const dlFmtBtn = $('btn-dl-fmt');

  dlFmtBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = dlMenu.classList.toggle('hidden');
    dlFmtBtn.setAttribute('aria-expanded', String(!open));
  });

  dlMenu.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest('[data-fmt]') as HTMLButtonElement;
    if (!item) return;
    state.fmt = item.dataset.fmt!;
    dlMenu.querySelectorAll('button').forEach(b => b.classList.remove('active', 'text-text'));
    item.classList.add('active', 'text-text');
    $('btn-dl').textContent = '↓ ' + state.fmt.toUpperCase();
    dlMenu.classList.add('hidden');
    dlFmtBtn.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', () => {
    dlMenu.classList.add('hidden');
    dlFmtBtn.setAttribute('aria-expanded', 'false');
  });
}

function bindSlider(sid: string, vid: string) {
  const s = $(sid) as HTMLInputElement;
  const v = $(vid);
  s.addEventListener('input', () => {
    v.textContent = s.value;
    schedule();
  });
}

function bindColor(cpId: string, hexId: string, swId: string) {
  const cp = $(cpId) as HTMLInputElement;
  const hx = $(hexId) as HTMLInputElement;
  const sw = $(swId);
  cp.addEventListener('input', () => {
    hx.value = cp.value.toUpperCase();
    sw.style.background = cp.value;
    schedule();
  });
  hx.addEventListener('change', () => {
    let v = hx.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      cp.value = v;
      sw.style.background = v;
      hx.value = v.toUpperCase();
      schedule();
    }
  });
}

function setFile(f: File) {
  const RASTER_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);
  if (f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')) {
    setStatus('SVG files cannot be used as input — upload a JPEG, PNG, or WebP', 'text-err');
    return;
  }
  if (f.type && !RASTER_TYPES.has(f.type)) {
    setStatus(`Unsupported type: ${f.type} — use JPEG, PNG, or WebP`, 'text-err');
    return;
  }

  $('fname').textContent = f.name;
  ($('btn-render') as HTMLButtonElement).disabled = false;

  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.fileName = f.name;
    render();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => setStatus('error loading image', 'text-err');
  img.src = url;
}

function schedule() {
  if (!state.image) return;
  if (state.debounce) clearTimeout(state.debounce);
  state.debounce = window.setTimeout(render, 350);
}

async function render() {
  if (!state.image || state.busy) return;
  state.busy = true;

  setStatus('rendering…', 'text-text');
  $('spinner').classList.remove('hidden');
  ($('btn-dl') as HTMLButtonElement).disabled = true;
  ($('btn-dl-fmt') as HTMLButtonElement).disabled = true;
  ($('btn-render') as HTMLButtonElement).disabled = true;

  const params: DitherParams = {
    row_spacing: parseInt(($('s-rs') as HTMLInputElement).value),
    dash_length: parseFloat(($('s-dl') as HTMLInputElement).value),
    min_gap: parseFloat(($('s-mg') as HTMLInputElement).value),
    tilt: parseFloat(($('s-tl') as HTMLInputElement).value),
    contrast: parseFloat(($('s-ct') as HTMLInputElement).value),
    max_dim: parseInt(($('s-md') as HTMLInputElement).value),
    stroke_width: parseFloat(($('s-sw') as HTMLInputElement).value),
    mode: state.mode,
    stroke_color: ($('hex-stroke') as HTMLInputElement).value,
    bg_color: state.bgNone ? null : ($('hex-bg') as HTMLInputElement).value,
    stroke_color2: state.gradOn ? state.gradColor : undefined,
    gradient_dir: state.gradDir,
  };

  try {
    const result = await imageToSvg(state.image, params);
    state.svgText = result.svg;
    state.svgBlob = new Blob([result.svg], { type: 'image/svg+xml' });
    state.svgW = result.width;
    state.svgH = result.height;

    const obj = $('preview-img') as HTMLObjectElement;
    if (obj.data) URL.revokeObjectURL(obj.data);
    const url = URL.createObjectURL(state.svgBlob);
    obj.data = url;

    $('empty-state').classList.add('hidden');
    $('preview-wrap').classList.remove('hidden');

    // Stats
    $('st-dashes').textContent = result.dashCount.toLocaleString();
    $('st-size').textContent = (state.svgBlob.size / 1024).toFixed(1) + ' KB';
    $('st-dims').textContent = `${result.width} × ${result.height}`;
    $('stats').classList.remove('hidden');

    setStatus(`${result.dashCount.toLocaleString()} dashes`, 'text-ok');
    ($('btn-dl') as HTMLButtonElement).disabled = false;
    ($('btn-dl-fmt') as HTMLButtonElement).disabled = false;
  } catch (e: any) {
    setStatus('error: ' + e.message, 'text-err');
    console.error(e);
  } finally {
    state.busy = false;
    $('spinner').classList.add('hidden');
    ($('btn-render') as HTMLButtonElement).disabled = false;
  }
}

function downloadAs(fmt: string) {
  if (!state.svgBlob) return;
  if (fmt === 'svg') {
    triggerDownload(URL.createObjectURL(state.svgBlob), 'linea.svg');
    return;
  }

  const mimeMap: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
  const url = URL.createObjectURL(state.svgBlob);
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || state.svgW;
    const h = img.naturalHeight || state.svgH;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (!blob) { setStatus('export failed', 'text-err'); return; }
      triggerDownload(URL.createObjectURL(blob), `linea.${fmt}`, 1000);
    }, mimeMap[fmt], fmt === 'jpeg' ? 0.92 : undefined);
  };
  img.onerror = () => { URL.revokeObjectURL(url); setStatus('export failed', 'text-err'); };
  img.src = url;
}

function triggerDownload(url: string, filename: string, revokeDelay = 1000) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), revokeDelay);
}

function setStatus(msg: string, cls: string) {
  const el = $('status-text');
  el.textContent = msg;
  el.className = 'ml-auto text-xs font-mono tabular-nums ' + cls;
}
