// Palette mapping: color subset selection, dithering and cleanup.
import { deltaE2000, deltaE76, redmean, rgbToLab, type Metric, type RGB } from './color';
import type { PreparedColor } from './palette';
import type { Grid } from './image';

export type DitherMethod =
  | 'none' | 'floyd-steinberg' | 'atkinson' | 'jarvis' | 'stucki' | 'burkes' | 'sierra' | 'sierra-lite'
  | 'bayer2' | 'bayer4' | 'bayer8';

export const DITHER_METHODS: { id: DitherMethod; label: string }[] = [
  { id: 'none', label: 'None (flat colors)' },
  { id: 'floyd-steinberg', label: 'Floyd-Steinberg' },
  { id: 'atkinson', label: 'Atkinson (lighter, high contrast)' },
  { id: 'jarvis', label: 'Jarvis-Judice-Ninke (smooth)' },
  { id: 'stucki', label: 'Stucki' },
  { id: 'burkes', label: 'Burkes' },
  { id: 'sierra', label: 'Sierra' },
  { id: 'sierra-lite', label: 'Sierra Lite' },
  { id: 'bayer2', label: 'Ordered (Bayer 2x2)' },
  { id: 'bayer4', label: 'Ordered (Bayer 4x4)' },
  { id: 'bayer8', label: 'Ordered (Bayer 8x8)' },
];

// [dx, dy, weight] with divisor
const KERNELS: Record<string, { div: number; taps: [number, number, number][] }> = {
  'floyd-steinberg': { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    div: 48,
    taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  stucki: {
    div: 42,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  burkes: { div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: {
    div: 32,
    taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  'sierra-lite': { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

function bayer(n: number): number[] {
  if (n === 1) return [0];
  const prev = bayer(n / 2);
  const h = n / 2;
  const out = new Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = prev[(y % h) * h + (x % h)];
      const q = (y < h ? 0 : 2) + (x < h ? 0 : 1);
      out[y * n + x] = 4 * v + [0, 2, 3, 1][q];
    }
  return out;
}

export interface QuantizeOptions {
  colors: PreparedColor[]; // allowed colors
  metric: Metric;
  maxColors: number; // 0 = no limit
  dither: DitherMethod;
  ditherStrength: number; // 0..1
  serpentine: boolean;
  alphaThreshold: number; // 0..255, below = empty peg
  minBeadsPerColor: number; // drop colors used fewer times than this (0 = off)
  removeIsolated: boolean;
}

export interface QuantizeResult {
  cells: Int16Array; // palette index, -1 = empty
  usedColors: number;
}

type Dist = (rgb: RGB, c: PreparedColor) => number;

function makeDist(metric: Metric): Dist {
  if (metric === 'redmean') return (rgb, c) => redmean(rgb, c.rgb);
  const labCache = new Map<number, ReturnType<typeof rgbToLab>>();
  const labOf = (rgb: RGB) => {
    const k = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    let l = labCache.get(k);
    if (!l) { l = rgbToLab(rgb); labCache.set(k, l); }
    return l;
  };
  return metric === 'cie76' ? (rgb, c) => deltaE76(labOf(rgb), c.lab) : (rgb, c) => deltaE2000(labOf(rgb), c.lab);
}

class Matcher {
  private cache = new Map<number, number>();
  private colors: PreparedColor[];
  private dist: Dist;
  constructor(colors: PreparedColor[], dist: Dist) { this.colors = colors; this.dist = dist; }
  /** returns position in this.colors */
  nearest(r: number, g: number, b: number): number {
    r = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    g = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    b = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const k = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    const rgb: RGB = [r, g, b];
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.colors.length; i++) {
      const d = this.dist(rgb, this.colors[i]);
      if (d < bd) { bd = d; best = i; }
    }
    this.cache.set(k, best);
    return best;
  }
}

/**
 * Picks the best subset of `colors` with at most `max` entries, by greedily removing the color whose
 * removal increases total (squared) error the least.
 */
export function selectColors(grid: Grid, colors: PreparedColor[], max: number, metric: Metric, alphaThreshold: number): PreparedColor[] {
  const dist = makeDist(metric);
  // Histogram at 5 bits/channel
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const d = grid.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < alphaThreshold) continue;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    let e = bins.get(k);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(k, e); }
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
  }
  const B = [...bins.values()].map((e) => ({ n: e.n, rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] as RGB }));
  if (!B.length) return [];
  // Prune to colors that are the nearest match of at least one bin.
  const K = colors.length;
  const nearestOf = B.map((bin) => {
    let best = 0, bd = Infinity;
    for (let c = 0; c < K; c++) { const dd = dist(bin.rgb, colors[c]); if (dd < bd) { bd = dd; best = c; } }
    return best;
  });
  if (max <= 0) max = K;
  const candidates = [...new Set(nearestOf)];
  if (candidates.length <= max) return candidates.map((i) => colors[i]);
  const A = candidates.length;
  const cand = candidates.map((i) => colors[i]);
  // Distance matrix and per-bin sorted candidate order
  const D = new Float64Array(B.length * A);
  const order: Uint16Array[] = [];
  for (let b = 0; b < B.length; b++) {
    for (let a = 0; a < A; a++) D[b * A + a] = dist(B[b].rgb, cand[a]);
    const o = Uint16Array.from({ length: A }, (_, i) => i);
    const row = D.subarray(b * A, b * A + A);
    o.sort((x, y) => row[x] - row[y]);
    order.push(o);
  }
  const active = new Uint8Array(A).fill(1);
  const ptr = new Uint16Array(B.length); // first active index in order[b]
  let remaining = A;
  const cost = new Float64Array(A);
  while (remaining > max) {
    cost.fill(0);
    for (let b = 0; b < B.length; b++) {
      const o = order[b];
      let p = ptr[b];
      while (!active[o[p]]) p++;
      ptr[b] = p;
      let q = p + 1;
      while (q < A && !active[o[q]]) q++;
      if (q >= A) continue;
      const best = o[p], second = o[q];
      cost[best] += B[b].n * (D[b * A + second] - D[b * A + best]);
    }
    let rm = -1, rc = Infinity;
    for (let a = 0; a < A; a++) if (active[a] && cost[a] < rc) { rc = cost[a]; rm = a; }
    active[rm] = 0;
    remaining--;
  }
  return cand.filter((_, a) => active[a]);
}

function mapGrid(grid: Grid, colors: PreparedColor[], opts: QuantizeOptions): Int16Array {
  const { width: W, height: H } = grid;
  const cells = new Int16Array(W * H).fill(-1);
  if (!colors.length) return cells;
  const matcher = new Matcher(colors, makeDist(opts.metric));
  const src = grid.data;
  const strength = Math.max(0, Math.min(1, opts.ditherStrength));
  const method = strength > 0 ? opts.dither : 'none';
  const opaque = (p: number) => src[p * 4 + 3] >= opts.alphaThreshold;

  if (method === 'none') {
    for (let p = 0; p < W * H; p++) {
      if (!opaque(p)) continue;
      cells[p] = colors[matcher.nearest(src[p * 4], src[p * 4 + 1], src[p * 4 + 2])].index;
    }
    return cells;
  }

  if (method.startsWith('bayer')) {
    const n = method === 'bayer2' ? 2 : method === 'bayer4' ? 4 : 8;
    const m = bayer(n);
    // Spread scales with how far apart palette colors are; ~ 1/ cube-root(colors) of range
    const spread = (255 / Math.max(2, Math.cbrt(colors.length))) * strength;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (!opaque(p)) continue;
        const t = ((m[(y % n) * n + (x % n)] + 0.5) / (n * n) - 0.5) * spread;
        cells[p] = colors[matcher.nearest(src[p * 4] + t, src[p * 4 + 1] + t, src[p * 4 + 2] + t)].index;
      }
    return cells;
  }

  const kernel = KERNELS[method];
  const buf = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) { buf[p * 3] = src[p * 4]; buf[p * 3 + 1] = src[p * 4 + 1]; buf[p * 3 + 2] = src[p * 4 + 2]; }
  for (let y = 0; y < H; y++) {
    const rtl = opts.serpentine && y % 2 === 1;
    for (let i = 0; i < W; i++) {
      const x = rtl ? W - 1 - i : i;
      const p = y * W + x;
      if (!opaque(p)) continue;
      const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2];
      const c = colors[matcher.nearest(r, g, b)];
      cells[p] = c.index;
      // Clamp the error so out-of-gamut accumulations don't explode
      const er = Math.max(-128, Math.min(128, (r - c.rgb[0]) * strength));
      const eg = Math.max(-128, Math.min(128, (g - c.rgb[1]) * strength));
      const eb = Math.max(-128, Math.min(128, (b - c.rgb[2]) * strength));
      for (const [dx0, dy, w] of kernel.taps) {
        const dx = rtl ? -dx0 : dx0;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!opaque(q)) continue;
        const f = w / kernel.div;
        buf[q * 3] += er * f; buf[q * 3 + 1] += eg * f; buf[q * 3 + 2] += eb * f;
      }
    }
  }
  return cells;
}

/** Replace single beads that differ from all 8 neighbors with the dominant neighbor color. */
export function removeIsolated(cells: Int16Array, W: number, H: number): void {
  const copy = cells.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const c = copy[p];
      if (c < 0) continue;
      const counts = new Map<number, number>();
      let same = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const v = copy[ny * W + nx];
          total++;
          if (v === c) same++;
          else if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      if (same > 0 || total < 3) continue;
      let best = -1, bn = 0;
      for (const [v, n] of counts) if (n > bn) { bn = n; best = v; }
      if (best >= 0 && bn >= Math.ceil(total / 2)) cells[p] = best;
    }
}

export function quantize(grid: Grid, opts: QuantizeOptions): QuantizeResult {
  let colors = selectColors(grid, opts.colors, opts.maxColors, opts.metric, opts.alphaThreshold);
  let cells = mapGrid(grid, colors, opts);
  if (opts.minBeadsPerColor > 1 && colors.length > 1) {
    for (let iter = 0; iter < 3; iter++) {
      const counts = new Map<number, number>();
      for (const c of cells) if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
      const keep = colors.filter((c) => (counts.get(c.index) ?? 0) >= opts.minBeadsPerColor);
      if (keep.length === colors.length || keep.length === 0) break;
      colors = keep;
      cells = mapGrid(grid, colors, opts);
    }
  }
  if (opts.removeIsolated) removeIsolated(cells, grid.width, grid.height);
  const used = new Set<number>();
  for (const c of cells) if (c >= 0) used.add(c);
  return { cells, usedColors: used.size };
}
