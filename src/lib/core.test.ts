import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToRgb, rgbToLab } from './color';
import { allowedColors, runGenerate, DEFAULT_SETTINGS } from './generate';
import { detectPixelScale, planSize, type SourceImage } from './image';
import { BUILTIN_PALETTES, parseCustomPalette, prepare } from './palette';
import { deserializeProject, ellipsePoints, emptyPattern, floodFill, linePoints, resizeCanvas, rotate, serializeProject, trim } from './pattern';
import { computeLayout, DEFAULT_PDF_OPTIONS, PAGE_SIZES } from './pdf';
import { generatePdf } from './pdf-render';
import { selectColors } from './quantize';

const hama = BUILTIN_PALETTES.find((p) => p.id === 'hama')!;

function makeImage(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): SourceImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { width: w, height: h, data, name: 'test' };
}

describe('palettes', () => {
  it('has the Hama palette with unique codes and valid hex', () => {
    expect(hama.colors.length).toBeGreaterThan(80);
    expect(new Set(hama.colors.map((c) => c.code)).size).toBe(hama.colors.length);
    for (const p of BUILTIN_PALETTES) for (const c of p.colors) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('matches the official Hama chart: new colors present, old ones excluded from generation', () => {
    const codes = new Set(hama.colors.map((c) => c.code));
    for (const c of ['H120', 'H121', 'H122']) expect(codes.has(c)).toBe(true);
    const base = { ownedOnly: false, includeEffects: true, excluded: [] };
    const allowed = allowedColors(hama, base, undefined).map((c) => c.code);
    expect(allowed).not.toContain('H33');
    expect(allowedColors(hama, { ...base, ownedOnly: true }, ['H33', 'H01']).map((c) => c.code)).toEqual(['H01', 'H33']);
  });
  it('parses CSV custom palettes', () => {
    const p = parseCustomPalette('code,name,hex\n1,White,#ffffff\n2,Black,000000,effect\n2,Dup,#123456', 'Mine');
    expect(p.colors).toEqual([
      { code: '1', name: 'White', hex: '#FFFFFF', effect: false },
      { code: '2', name: 'Black', hex: '#000000', effect: true },
      { code: '2-2', name: 'Dup', hex: '#123456', effect: false },
    ]);
  });
});

describe('color', () => {
  it('computes CIEDE2000 against a published reference pair', () => {
    // Sharma et al. test pair 1: dE00 = 2.0425
    const d = Math.sqrt(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]));
    expect(d).toBeCloseTo(2.0425, 3);
  });
  it('converts white to L=100', () => {
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 1);
    expect(hexToRgb('#0a0B0c')).toEqual([10, 11, 12]);
  });
});

describe('image sizing', () => {
  it('detects upscaled pixel art', () => {
    // 12x10 logical pixels, each 6x6
    const img = makeImage(72, 60, (x, y) => {
      const lx = Math.floor(x / 6), ly = Math.floor(y / 6);
      const v = (lx * 37 + ly * 91) % 5;
      return [v * 60, 255 - v * 50, (v * 97) % 256, 255];
    });
    const s = detectPixelScale(img);
    expect(s).not.toBeNull();
    expect(s!.scale).toBe(6);
    expect([s!.nativeWidth, s!.nativeHeight]).toEqual([12, 10]);
  });
  it('does not flag a smooth gradient as pixel art', () => {
    const img = makeImage(200, 100, (x, y) => [x, y * 2, (x + y) % 256, 255]);
    expect(detectPixelScale(img)).toBeNull();
  });
  it('plans sizes for each mode', () => {
    const img = makeImage(400, 200, () => [0, 0, 0, 255]);
    const base = { ...DEFAULT_SETTINGS.size };
    expect(planSize(img, { ...base, mode: 'auto', autoMax: 58 }, null)).toMatchObject({ width: 58, height: 29 });
    expect(planSize(img, { ...base, mode: 'width', width: 40 }, null)).toMatchObject({ width: 40, height: 20 });
    const fit = planSize(img, { ...base, mode: 'fit', width: 29, height: 29 }, null);
    expect(fit.width).toBe(29);
    expect(Math.abs(fit.height - 14.5)).toBeLessThanOrEqual(0.5);
    const pad = planSize(img, { ...base, mode: 'exact', width: 29, height: 29, aspect: 'pad' }, null);
    expect(pad.dst.h).toBe(14);
    expect(pad.dst.y).toBe(7);
    const crop = planSize(img, { ...base, mode: 'exact', width: 29, height: 29, aspect: 'crop' }, null);
    expect(crop.src.w).toBe(200);
  });
});

describe('quantization', () => {
  it('maps pure colors to the nearest palette entries', () => {
    const img = makeImage(4, 1, (x) => [[255, 255, 255, 255], [0, 0, 0, 255], [200, 0, 10, 255], [0, 0, 0, 0]][x] as [number, number, number, number]);
    const r = runGenerate(img, hama, undefined, { ...DEFAULT_SETTINGS, detectPixelArt: false });
    const codes = Array.from(r.cells, (c) => (c < 0 ? null : hama.colors[c].code));
    expect(codes[0]).toBe('H01');
    expect(codes[1]).toBe('H18');
    expect(hama.colors[r.cells[2]].name).toMatch(/Red/);
    expect(codes[3]).toBeNull();
  });
  it('respects the max color count and the owned list', () => {
    const img = makeImage(60, 40, (x, y) => [x * 4, y * 6, 128, 255]);
    const r = runGenerate(img, hama, undefined, { ...DEFAULT_SETTINGS, maxColors: 5, dither: 'floyd-steinberg' });
    expect(r.usedColors).toBeLessThanOrEqual(5);
    const owned = ['H01', 'H18', 'H05'];
    const r2 = runGenerate(img, hama, owned, { ...DEFAULT_SETTINGS, ownedOnly: true, dither: 'atkinson' });
    for (const c of r2.cells) expect(owned).toContain(hama.colors[c].code);
  });
  it('selects distinct colors when reducing', () => {
    const img = makeImage(30, 10, (x) => (x < 10 ? [255, 255, 255, 255] : x < 20 ? [0, 0, 0, 255] : [0, 60, 200, 255]));
    const sel = selectColors({ width: 30, height: 10, data: Float32Array.from(img.data) }, prepare(hama), 3, 'ciede2000', 128);
    expect(sel.length).toBe(3);
  });
  it('supports every dither method', () => {
    const img = makeImage(20, 20, (x, y) => [x * 12, y * 12, 100, 255]);
    for (const dither of ['floyd-steinberg', 'atkinson', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra-lite', 'bayer2', 'bayer4', 'bayer8'] as const) {
      const r = runGenerate(img, hama, undefined, { ...DEFAULT_SETTINGS, size: { ...DEFAULT_SETTINGS.size, mode: 'exact', width: 20, height: 20 }, dither });
      expect(r.cells.length).toBe(400);
      expect(Array.from(r.cells).every((c) => c >= 0)).toBe(true);
    }
  });
});

describe('pattern ops', () => {
  it('fills, resizes, rotates, trims and round-trips', () => {
    const p = emptyPattern(5, 4);
    p.cells = floodFill(p, 0, 0, 3);
    expect(Array.from(p.cells).every((c) => c === 3)).toBe(true);
    const r = resizeCanvas(p, 7, 6, 'c');
    expect(r.cells[0]).toBe(-1);
    expect(r.cells[1 * 7 + 1]).toBe(3);
    expect(trim(r)).toMatchObject({ width: 5, height: 4 });
    const rot = rotate(p, true);
    expect([rot.width, rot.height]).toEqual([4, 5]);
    expect(linePoints(0, 0, 3, 3)).toHaveLength(4);
    expect(ellipsePoints(0, 0, 4, 4, true).length).toBeGreaterThan(9);
    const proj = { id: 'x', name: 'T', paletteId: 'hama', pattern: p, createdAt: 1, updatedAt: 2 };
    const s = serializeProject(proj, hama);
    const back = deserializeProject(JSON.parse(JSON.stringify(s)), BUILTIN_PALETTES).project;
    expect(Array.from(back.pattern.cells)).toEqual(Array.from(p.cells));
  });
});

describe('pdf', () => {
  const p = emptyPattern(58, 58);
  p.cells.fill(0);
  it('lays out one 29x29 board per iPad Pro 11 page at 5 mm', () => {
    const L = computeLayout(p, { ...DEFAULT_PDF_OPTIONS, pageSizeId: 'ipad-pro-11-m4' });
    expect(L.tileW).toBe(29);
    expect(L.tiles).toHaveLength(4);
    expect(Math.max(L.pageW, L.pageH)).toBeCloseTo(232.8, 0);
  });
  it('uses iPad screen sizes with the right aspect ratio', () => {
    const pro11 = PAGE_SIZES.find((s) => s.id === 'ipad-pro-11-m4')!;
    expect(pro11.h / pro11.w).toBeCloseTo(2420 / 1668, 2);
  });
  it('generates a PDF with true millimetre page size', () => {
    const doc = generatePdf(p, hama, { ...DEFAULT_PDF_OPTIONS, pageSizeId: 'a4' });
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThanOrEqual(3);
    const last = doc.internal.pageSize;
    expect(Math.min(last.getWidth(), last.getHeight())).toBeCloseTo(210, 0);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
