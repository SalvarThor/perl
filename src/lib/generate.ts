// The full image -> pattern pipeline (runs in a worker, also usable directly in tests).
import { applyAdjustments, detectPixelScale, planSize, removeBackground, resample, type Adjustments, type ResampleMethod, type SizeOptions, type SourceImage, type PixelScale } from './image';
import type { Metric } from './color';
import { prepare, type Palette } from './palette';
import { quantize, type DitherMethod } from './quantize';

export interface GenerateSettings {
  size: SizeOptions;
  detectPixelArt: boolean;
  resample: ResampleMethod;
  adjustments: Adjustments;
  removeBg: boolean;
  bgTolerance: number;
  alphaThreshold: number;
  paletteId: string;
  ownedOnly: boolean;
  includeEffects: boolean;
  /** Codes explicitly excluded for this generation (in addition to owned/effects filters). */
  excluded: string[];
  maxColors: number;
  metric: Metric;
  dither: DitherMethod;
  ditherStrength: number;
  serpentine: boolean;
  minBeadsPerColor: number;
  removeIsolated: boolean;
}

export const DEFAULT_SETTINGS: GenerateSettings = {
  size: { mode: 'auto', width: 29, height: 29, aspect: 'crop', autoMax: 58 },
  detectPixelArt: true,
  resample: 'average',
  adjustments: { brightness: 0, contrast: 0, saturation: 0, gamma: 1 },
  removeBg: false,
  bgTolerance: 40,
  alphaThreshold: 128,
  paletteId: 'hama',
  ownedOnly: false,
  includeEffects: false,
  excluded: [],
  maxColors: 0,
  metric: 'ciede2000',
  dither: 'none',
  ditherStrength: 0.8,
  serpentine: true,
  minBeadsPerColor: 0,
  removeIsolated: false,
};

export interface GenerateResult {
  width: number;
  height: number;
  cells: Int16Array;
  usedColors: number;
  reason: string;
  pixelArt: PixelScale | null;
  allowedCount: number;
  ms: number;
}

export function allowedColors(palette: Palette, s: Pick<GenerateSettings, 'ownedOnly' | 'includeEffects' | 'excluded'>, owned: string[] | undefined) {
  const ownedSet = s.ownedOnly && owned ? new Set(owned) : null;
  const ex = new Set(s.excluded);
  return prepare(palette).filter((c) => (s.includeEffects || !c.effect) && (!ownedSet || ownedSet.has(c.code)) && !ex.has(c.code));
}

let pixelCache: { img: SourceImage; scale: PixelScale | null } | null = null;

export function runGenerate(img: SourceImage, palette: Palette, owned: string[] | undefined, s: GenerateSettings): GenerateResult {
  const t0 = performance.now();
  let pa: PixelScale | null = null;
  if (s.detectPixelArt) {
    if (pixelCache?.img !== img) pixelCache = { img, scale: detectPixelScale(img) };
    pa = pixelCache.scale;
  }
  const plan = planSize(img, s.size, pa);
  // For detected pixel art at native size, dominant sampling is exact.
  const method = plan.pixelArt && s.size.mode === 'auto' ? 'dominant' : s.resample;
  const grid = resample(img, plan, method);
  applyAdjustments(grid, s.adjustments);
  if (s.removeBg) removeBackground(grid, s.bgTolerance);
  const colors = allowedColors(palette, s, owned);
  const q = quantize(grid, {
    colors, metric: s.metric, maxColors: s.maxColors, dither: s.dither, ditherStrength: s.ditherStrength,
    serpentine: s.serpentine, alphaThreshold: s.alphaThreshold, minBeadsPerColor: s.minBeadsPerColor,
    removeIsolated: s.removeIsolated,
  });
  return {
    width: plan.width, height: plan.height, cells: q.cells, usedColors: q.usedColors, reason: plan.reason,
    pixelArt: pa, allowedCount: colors.length, ms: Math.round(performance.now() - t0),
  };
}
