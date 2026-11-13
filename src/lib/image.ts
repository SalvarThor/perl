// Image loading, pixel-art detection, sizing and resampling.

export interface SourceImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
  name: string;
}

/** RGBA float buffer (0..255 for every channel) at pattern resolution. */
export interface Grid {
  width: number;
  height: number;
  data: Float32Array;
}

const MAX_SOURCE_SIDE = 3000;

export async function loadImageFile(file: Blob, name = 'image'): Promise<SourceImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return { width: w, height: h, data, name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PixelScale {
  scale: number;
  offsetX: number;
  offsetY: number;
  nativeWidth: number;
  nativeHeight: number;
}

function edgeScore(positions: Int32Array, count: number, maxScale: number): { scale: number; offset: number } {
  let best = { scale: 1, offset: 0 };
  if (count < 12) return best;
  for (let s = 2; s <= maxScale; s++) {
    const hist = new Int32Array(s);
    for (let i = 0; i < count; i++) hist[positions[i] % s]++;
    let bo = 0;
    for (let o = 1; o < s; o++) if (hist[o] > hist[bo]) bo = o;
    if (hist[bo] / count >= 0.93) best = { scale: s, offset: bo };
  }
  return best;
}

/**
 * Detects images that are upscaled pixel art (each logical pixel is an s x s block)
 * by checking whether color edges fall on a regular grid.
 */
export function detectPixelScale(img: SourceImage): PixelScale | null {
  const { width: w, height: h, data } = img;
  if (w < 8 || h < 8) return null;
  const diff = (i: number, j: number) =>
    Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) +
    Math.abs(data[i + 3] - data[j + 3]);
  const TH = 40;
  const collect = (horizontal: boolean) => {
    const lines = horizontal ? h : w;
    const len = horizontal ? w : h;
    const step = Math.max(1, Math.floor(lines / 300));
    const pos = new Int32Array(Math.min(400000, Math.ceil(lines / step) * len));
    let n = 0;
    for (let l = 0; l < lines && n < pos.length; l += step) {
      for (let k = 1; k < len && n < pos.length; k++) {
        const a = horizontal ? (l * w + k) * 4 : (k * w + l) * 4;
        const b = horizontal ? (l * w + k - 1) * 4 : ((k - 1) * w + l) * 4;
        if (diff(a, b) > TH) pos[n++] = k;
      }
    }
    return { pos, n };
  };
  const hx = collect(true);
  const vy = collect(false);
  const maxScale = Math.min(64, Math.floor(Math.min(w, h) / 4));
  const sx = edgeScore(hx.pos, hx.n, maxScale);
  const sy = edgeScore(vy.pos, vy.n, maxScale);
  // Require a consistent square grid (allow one axis to be undetectable, e.g. only vertical stripes)
  let scale = 1;
  if (sx.scale > 1 && sy.scale > 1) {
    if (sx.scale === sy.scale) scale = sx.scale;
    else if (sx.scale % sy.scale === 0) scale = sy.scale;
    else if (sy.scale % sx.scale === 0) scale = sx.scale;
  } else if (sx.scale > 1 && vy.n < 12) scale = sx.scale;
  else if (sy.scale > 1 && hx.n < 12) scale = sy.scale;
  if (scale < 2) return null;
  const offsetX = sx.scale > 1 ? sx.offset % scale : 0;
  const offsetY = sy.scale > 1 ? sy.offset % scale : 0;
  const nativeWidth = Math.floor((w - offsetX) / scale);
  const nativeHeight = Math.floor((h - offsetY) / scale);
  if (nativeWidth < 2 || nativeHeight < 2) return null;
  return { scale, offsetX, offsetY, nativeWidth, nativeHeight };
}

export type SizeMode = 'auto' | 'width' | 'height' | 'fit' | 'exact';
export type AspectHandling = 'stretch' | 'crop' | 'pad';

export interface SizeOptions {
  mode: SizeMode;
  width: number;
  height: number;
  aspect: AspectHandling; // used for 'exact'
  /** Longest side when auto-sizing a photo / non pixel-art image. */
  autoMax: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface SizePlan {
  width: number;
  height: number;
  /** Source region to sample. */
  src: Rect;
  /** Destination region inside the pattern (for 'pad'). */
  dst: Rect;
  reason: string;
  pixelArt: PixelScale | null;
}

export function planSize(img: SourceImage, opts: SizeOptions, pixelArt: PixelScale | null): SizePlan {
  const full: Rect = { x: 0, y: 0, w: img.width, h: img.height };
  const ar = img.width / img.height;
  const clamp = (v: number) => Math.max(1, Math.min(500, Math.round(v)));
  const simple = (W: number, H: number, reason: string, src = full): SizePlan => ({
    width: W, height: H, src, dst: { x: 0, y: 0, w: W, h: H }, reason, pixelArt,
  });
  switch (opts.mode) {
    case 'auto': {
      if (pixelArt) {
        return simple(pixelArt.nativeWidth, pixelArt.nativeHeight,
          `Pixel art detected (${pixelArt.scale}x upscaled), using native ${pixelArt.nativeWidth} x ${pixelArt.nativeHeight}`,
          { x: pixelArt.offsetX, y: pixelArt.offsetY, w: pixelArt.nativeWidth * pixelArt.scale, h: pixelArt.nativeHeight * pixelArt.scale });
      }
      if (Math.max(img.width, img.height) <= Math.max(opts.autoMax, 64)) {
        return simple(img.width, img.height, `Small image, using 1 bead per pixel`);
      }
      const W = ar >= 1 ? opts.autoMax : clamp(opts.autoMax * ar);
      const H = ar >= 1 ? clamp(opts.autoMax / ar) : opts.autoMax;
      return simple(W, H, `Longest side fitted to ${opts.autoMax} beads`);
    }
    case 'width': return simple(clamp(opts.width), clamp(opts.width / ar), 'Width fixed, height follows aspect ratio');
    case 'height': return simple(clamp(opts.height * ar), clamp(opts.height), 'Height fixed, width follows aspect ratio');
    case 'fit': {
      const s = Math.min(opts.width / img.width, opts.height / img.height);
      return simple(clamp(img.width * s), clamp(img.height * s), `Fitted within ${opts.width} x ${opts.height}`);
    }
    case 'exact': {
      const W = clamp(opts.width), H = clamp(opts.height);
      const tar = W / H;
      if (opts.aspect === 'stretch') return simple(W, H, 'Stretched to exact size');
      if (opts.aspect === 'crop') {
        let src: Rect;
        if (ar > tar) { const sw = img.height * tar; src = { x: (img.width - sw) / 2, y: 0, w: sw, h: img.height }; }
        else { const sh = img.width / tar; src = { x: 0, y: (img.height - sh) / 2, w: img.width, h: sh }; }
        return simple(W, H, 'Center-cropped to exact size', src);
      }
      // pad
      const s = Math.min(W / img.width, H / img.height);
      const dw = Math.max(1, Math.round(img.width * s)), dh = Math.max(1, Math.round(img.height * s));
      return {
        width: W, height: H, src: full,
        dst: { x: Math.floor((W - dw) / 2), y: Math.floor((H - dh) / 2), w: dw, h: dh },
        reason: 'Fitted and padded with empty pegs', pixelArt,
      };
    }
  }
}

export type ResampleMethod = 'average' | 'nearest' | 'dominant';

export const RESAMPLE_METHODS: { id: ResampleMethod; label: string; hint: string }[] = [
  { id: 'average', label: 'Average', hint: 'Smooth; best for photos' },
  { id: 'dominant', label: 'Dominant color', hint: 'Crisp edges; keeps outlines and pixel art clean' },
  { id: 'nearest', label: 'Nearest (center sample)', hint: 'Fast, can look noisy on photos' },
];

/** Resample src rect of the image into a w x h grid of RGBA floats. Alpha-weighted. */
export function resample(img: SourceImage, plan: SizePlan, method: ResampleMethod): Grid {
  const { width: W, height: H, src, dst } = plan;
  const out = new Float32Array(W * H * 4); // transparent by default
  const d = img.data, iw = img.width, ih = img.height;
  const sxPer = src.w / dst.w, syPer = src.h / dst.h;
  for (let ty = 0; ty < dst.h; ty++) {
    const y0 = src.y + ty * syPer, y1 = y0 + syPer;
    for (let tx = 0; tx < dst.w; tx++) {
      const x0 = src.x + tx * sxPer, x1 = x0 + sxPer;
      const o = ((ty + dst.y) * W + tx + dst.x) * 4;
      if (method === 'nearest') {
        const px = Math.min(iw - 1, Math.max(0, Math.floor((x0 + x1) / 2)));
        const py = Math.min(ih - 1, Math.max(0, Math.floor((y0 + y1) / 2)));
        const i = (py * iw + px) * 4;
        out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; out[o + 3] = d[i + 3];
        continue;
      }
      const xa = Math.max(0, Math.floor(x0)), xb = Math.min(iw, Math.ceil(x1));
      const ya = Math.max(0, Math.floor(y0)), yb = Math.min(ih, Math.ceil(y1));
      if (method === 'average') {
        let r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (let y = ya; y < yb; y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          if (wy <= 0) continue;
          for (let x = xa; x < xb; x++) {
            const wx = Math.min(x + 1, x1) - Math.max(x, x0);
            if (wx <= 0) continue;
            const wgt = wx * wy;
            const i = (y * iw + x) * 4;
            const al = d[i + 3] * wgt;
            r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; wsum += wgt;
          }
        }
        if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
        out[o + 3] = wsum > 0 ? a / wsum : 0;
      } else {
        // dominant: bin colors at 4 bits/channel, pick heaviest bin, average its members
        const bins = new Map<number, number[]>();
        let total = 0, transparent = 0;
        for (let y = ya; y < yb; y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          if (wy <= 0) continue;
          for (let x = xa; x < xb; x++) {
            const wx = Math.min(x + 1, x1) - Math.max(x, x0);
            if (wx <= 0) continue;
            const wgt = wx * wy;
            const i = (y * iw + x) * 4;
            total += wgt;
            if (d[i + 3] < 128) { transparent += wgt; continue; }
            const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
            let e = bins.get(key);
            if (!e) { e = [0, 0, 0, 0]; bins.set(key, e); }
            e[0] += wgt; e[1] += d[i] * wgt; e[2] += d[i + 1] * wgt; e[3] += d[i + 2] * wgt;
          }
        }
        let best: number[] | null = null;
        for (const e of bins.values()) if (!best || e[0] > best[0]) best = e;
        if (!best || transparent > best[0]) { out[o + 3] = 0; continue; }
        out[o] = best[1] / best[0]; out[o + 1] = best[2] / best[0]; out[o + 2] = best[3] / best[0];
        out[o + 3] = total > 0 ? 255 * (1 - transparent / total) : 0;
        if (out[o + 3] < 128) out[o + 3] = 128; // dominant opaque wins
      }
    }
  }
  return { width: W, height: H, data: out };
}

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  gamma: number; // 0.2..3, 1 = neutral
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0, gamma: 1 };

export function applyAdjustments(g: Grid, adj: Adjustments): void {
  const { brightness, contrast, saturation, gamma } = adj;
  if (!brightness && !contrast && !saturation && gamma === 1) return;
  const cf = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const sf = 1 + saturation / 100;
  const bOff = brightness * 2.55;
  const d = g.data;
  const inv = 1 / gamma;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    if (gamma !== 1) {
      r = 255 * Math.pow(r / 255, inv); gg = 255 * Math.pow(gg / 255, inv); b = 255 * Math.pow(b / 255, inv);
    }
    r = cf * (r - 128) + 128 + bOff; gg = cf * (gg - 128) + 128 + bOff; b = cf * (b - 128) + 128 + bOff;
    if (sf !== 1) {
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = l + (r - l) * sf; gg = l + (gg - l) * sf; b = l + (b - l) * sf;
    }
    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, gg));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }
}

/**
 * Make the background transparent by flood-filling from the border with cells similar to the
 * border's most common color. Tolerance is a RGB distance (0..441).
 */
export function removeBackground(g: Grid, tolerance: number): void {
  const { width: W, height: H, data: d } = g;
  // Most common border color (coarse bins)
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const visitBorder = (fn: (i: number) => void) => {
    for (let x = 0; x < W; x++) { fn(x); fn((H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { fn(y * W); fn(y * W + W - 1); }
  };
  visitBorder((p) => {
    const i = p * 4;
    if (d[i + 3] < 128) return;
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    counts.set(key, e);
  });
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return;
  const br = best.r / best.n, bg = best.g / best.n, bb = best.b / best.n;
  const tol2 = tolerance * tolerance;
  const similar = (p: number) => {
    const i = p * 4;
    if (d[i + 3] < 128) return true;
    const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  visitBorder((p) => { if (!seen[p] && similar(p)) { seen[p] = 1; stack.push(p); } });
  while (stack.length) {
    const p = stack.pop()!;
    d[p * 4 + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
    for (const q of nb) if (q >= 0 && !seen[q] && similar(q)) { seen[q] = 1; stack.push(q); }
  }
}

export function gridToImageData(g: Grid): ImageData {
  const out = new ImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) out.data[i] = g.data[i];
  return out;
}
