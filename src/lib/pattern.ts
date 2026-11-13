import type { Palette } from './palette';

export interface Pattern {
  width: number;
  height: number;
  /** palette color index per cell, -1 = empty peg */
  cells: Int16Array;
}

export interface Project {
  id: string;
  name: string;
  paletteId: string;
  pattern: Pattern;
  createdAt: number;
  updatedAt: number;
}

export interface SerializedProject {
  format: 'perler-studio';
  version: 1;
  id: string;
  name: string;
  paletteId: string;
  width: number;
  height: number;
  /** Color codes referenced by cells. */
  codes: string[];
  /** Index into codes per cell, -1 = empty. Row-major. */
  cells: number[];
  createdAt: number;
  updatedAt: number;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyPattern(width: number, height: number): Pattern {
  return { width, height, cells: new Int16Array(width * height).fill(-1) };
}

export function serializeProject(p: Project, palette: Palette): SerializedProject {
  const codes: string[] = [];
  const map = new Map<number, number>();
  const cells = Array.from(p.pattern.cells, (c) => {
    if (c < 0) return -1;
    let i = map.get(c);
    if (i === undefined) { i = codes.length; codes.push(palette.colors[c]?.code ?? '?'); map.set(c, i); }
    return i;
  });
  return {
    format: 'perler-studio', version: 1, id: p.id, name: p.name, paletteId: p.paletteId,
    width: p.pattern.width, height: p.pattern.height, codes, cells, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export function deserializeProject(s: SerializedProject, palettes: Palette[]): { project: Project; missing: string[] } {
  if (s.format !== 'perler-studio') throw new Error('Not a Perler Studio pattern file');
  const palette = palettes.find((p) => p.id === s.paletteId);
  if (!palette) throw new Error(`Palette "${s.paletteId}" is not available. Import it first.`);
  const byCode = new Map(palette.colors.map((c, i) => [c.code, i]));
  const missing: string[] = [];
  const idx = s.codes.map((code) => {
    const i = byCode.get(code);
    if (i === undefined) { missing.push(code); return -1; }
    return i;
  });
  const cells = Int16Array.from(s.cells, (c) => (c < 0 ? -1 : idx[c] ?? -1));
  return {
    project: {
      id: s.id || newId(), name: s.name || 'Untitled', paletteId: s.paletteId,
      pattern: { width: s.width, height: s.height, cells },
      createdAt: s.createdAt || Date.now(), updatedAt: s.updatedAt || Date.now(),
    },
    missing,
  };
}

export function colorCounts(p: Pattern): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of p.cells) if (c >= 0) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

// ---- editing operations (all mutate a copy and return it) ----

export function floodFill(p: Pattern, x: number, y: number, color: number, diagonal = false): Int16Array {
  const { width: W, height: H } = p;
  const cells = p.cells.slice();
  const target = cells[y * W + x];
  if (target === color) return cells;
  const stack = [y * W + x];
  while (stack.length) {
    const q = stack.pop()!;
    if (cells[q] !== target) continue;
    cells[q] = color;
    const qx = q % W, qy = (q / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!diagonal && dx && dy) continue;
        const nx = qx + dx, ny = qy + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && cells[ny * W + nx] === target) stack.push(ny * W + nx);
      }
  }
  return cells;
}

export function replaceColor(p: Pattern, from: number, to: number): Int16Array {
  return p.cells.map((c) => (c === from ? to : c));
}

export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const pts: [number, number][] = [];
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++)
      if (filled || y === ay || y === by || x === ax || x === bx) pts.push([x, y]);
  return pts;
}

export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const pts: [number, number][] = [];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
  return pts;
}

export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';

export function resizeCanvas(p: Pattern, W: number, H: number, anchor: Anchor): Pattern {
  const out = emptyPattern(W, H);
  const ax = anchor.includes('l') ? 0 : anchor.includes('r') ? 2 : 1;
  const ay = anchor.startsWith('t') ? 0 : anchor.startsWith('b') ? 2 : 1;
  const ox = ax === 0 ? 0 : ax === 2 ? W - p.width : Math.floor((W - p.width) / 2);
  const oy = ay === 0 ? 0 : ay === 2 ? H - p.height : Math.floor((H - p.height) / 2);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.cells[ny * W + nx] = p.cells[y * p.width + x];
    }
  return out;
}

export function flip(p: Pattern, horizontal: boolean): Pattern {
  const out = emptyPattern(p.width, p.height);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const sx = horizontal ? p.width - 1 - x : x, sy = horizontal ? y : p.height - 1 - y;
      out.cells[y * p.width + x] = p.cells[sy * p.width + sx];
    }
  return out;
}

export function rotate(p: Pattern, clockwise: boolean): Pattern {
  const out = emptyPattern(p.height, p.width);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const nx = clockwise ? p.height - 1 - y : y;
      const ny = clockwise ? x : p.width - 1 - x;
      out.cells[ny * out.width + nx] = p.cells[y * p.width + x];
    }
  return out;
}

/** Bounding box of non-empty cells, or null if empty. */
export function contentBounds(p: Pattern): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (p.cells[y * p.width + x] >= 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function trim(p: Pattern): Pattern {
  const b = contentBounds(p);
  if (!b) return p;
  const out = emptyPattern(b.w, b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) out.cells[y * b.w + x] = p.cells[(y + b.y) * p.width + x + b.x];
  return out;
}
