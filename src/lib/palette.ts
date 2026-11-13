import hama from '../palettes/hama.json';
import perler from '../palettes/perler.json';
import artkal from '../palettes/artkal-s.json';
import { hexToRgb, rgbToLab, type Lab, type RGB } from './color';

export interface BeadColor {
  code: string;
  name: string;
  hex: string;
  /** Translucent, neon, glow, metallic, pearl... colors a single RGB value can't represent well. */
  effect: boolean;
  /** No longer on the manufacturer's current color chart. */
  discontinued?: boolean;
  /** Color value is a rough approximation (e.g. sampled from a product photo). */
  approx?: boolean;
}

export interface Palette {
  id: string;
  name: string;
  brand: string;
  source?: string;
  custom?: boolean;
  colors: BeadColor[];
}

export interface PreparedColor extends BeadColor {
  /** Index into palette.colors */
  index: number;
  rgb: RGB;
  lab: Lab;
}

export const BUILTIN_PALETTES: Palette[] = [hama as Palette, perler as Palette, artkal as Palette];
export const DEFAULT_PALETTE_ID = 'hama';

const prepCache = new WeakMap<Palette, PreparedColor[]>();

export function prepare(p: Palette): PreparedColor[] {
  let v = prepCache.get(p);
  if (!v) {
    v = p.colors.map((c, index) => {
      const rgb = hexToRgb(c.hex);
      return { ...c, index, rgb, lab: rgbToLab(rgb) };
    });
    prepCache.set(p, v);
  }
  return v;
}

/**
 * Parse a custom palette from CSV/TSV ("code,name,hex" per line, optional 4th column "effect")
 * or JSON (either a Palette object or an array of colors).
 */
export function parseCustomPalette(text: string, name: string): Palette {
  const id = 'custom-' + Date.now().toString(36);
  const trimmed = text.trim();
  let colors: BeadColor[] = [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : data.colors;
    if (!Array.isArray(arr)) throw new Error('JSON must be an array of colors or an object with a "colors" array');
    colors = arr.map((c: Record<string, unknown>, i: number) => ({
      code: String(c.code ?? c.id ?? i + 1),
      name: String(c.name ?? c.code ?? `Color ${i + 1}`),
      hex: normHex(String(c.hex ?? c.color ?? '')),
      effect: Boolean(c.effect),
    }));
    if (!Array.isArray(data) && typeof data.name === 'string') name = data.name;
  } else {
    for (const raw of trimmed.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') && !/^#[0-9a-f]{3,6}\b/i.test(line)) continue;
      const parts = line.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
      const hexIdx = parts.findIndex((s) => /^#?[0-9a-f]{6}$/i.test(s));
      if (hexIdx < 0) continue; // header or junk
      const others = parts.filter((_, i) => i !== hexIdx);
      colors.push({
        code: others[0] || String(colors.length + 1),
        name: others[1] || others[0] || `Color ${colors.length + 1}`,
        hex: normHex(parts[hexIdx]),
        effect: /^(1|true|yes|effect)$/i.test(others[2] ?? ''),
      });
    }
  }
  colors = colors.filter((c) => /^#[0-9A-F]{6}$/.test(c.hex));
  if (!colors.length) throw new Error('No colors found. Expected lines like: H01,White,#E5ECF1');
  const seen = new Set<string>();
  for (const c of colors) {
    let code = c.code, n = 2;
    while (seen.has(code)) code = `${c.code}-${n++}`;
    c.code = code;
    seen.add(code);
  }
  return { id, name, brand: 'Custom', custom: true, colors };
}

function normHex(h: string): string {
  h = h.trim();
  if (!h.startsWith('#')) h = '#' + h;
  return h.toUpperCase();
}
