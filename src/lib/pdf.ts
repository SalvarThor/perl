import type { Pattern } from './pattern';

export interface PageSizePreset {
  id: string;
  label: string;
  /** Portrait width/height in mm. */
  w: number;
  h: number;
  screen: boolean;
  note?: string;
}

const screen = (id: string, label: string, pxW: number, pxH: number, ppi: number, note?: string): PageSizePreset => ({
  id, label, screen: true, note,
  w: Math.round((pxH / ppi) * 25.4 * 10) / 10, // portrait: short side
  h: Math.round((pxW / ppi) * 25.4 * 10) / 10,
});

/**
 * iPad presets use the physical size of the display (resolution / pixel density). A PDF page of exactly
 * that size, shown full screen with "fit to screen", is displayed at real-world 1:1 scale.
 */
export const PAGE_SIZES: PageSizePreset[] = [
  screen('ipad-pro-13-m4', 'iPad Pro 13" (M4 / M5)', 2752, 2064, 264),
  screen('ipad-pro-12.9', 'iPad Pro 12.9" (1st-6th gen) / iPad Air 13"', 2732, 2048, 264),
  screen('ipad-pro-11-m4', 'iPad Pro 11" (M4 / M5)', 2420, 1668, 264),
  screen('ipad-pro-11', 'iPad Pro 11" (1st-4th gen)', 2388, 1668, 264),
  screen('ipad-air-11', 'iPad Air 11" / Air 10.9" / iPad 10th gen / iPad (A16)', 2360, 1640, 264),
  screen('ipad-10.2', 'iPad 10.2" (7th-9th gen)', 2160, 1620, 264),
  screen('ipad-mini', 'iPad mini (6th / 7th gen)', 2266, 1488, 326),
  { id: 'a4', label: 'A4 paper', w: 210, h: 297, screen: false },
  { id: 'letter', label: 'US Letter paper', w: 215.9, h: 279.4, screen: false },
  { id: 'a3', label: 'A3 paper', w: 297, h: 420, screen: false },
  { id: 'custom', label: 'Custom size', w: 200, h: 200, screen: false },
];

/** Board sizes are Hama's large square pegboards (841 / 3,249 / 256 pegs). */
export const BEAD_SIZES = [
  { id: 'mini', label: 'Mini (2.5 mm)', pitch: 2.5, board: 57 },
  { id: 'midi', label: 'Midi / Perler (5 mm)', pitch: 5, board: 29 },
  { id: 'maxi', label: 'Maxi (10 mm)', pitch: 10, board: 16 },
];

export interface PdfOptions {
  pageSizeId: string;
  customW: number;
  customH: number;
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Distance between peg centers in mm. */
  pitch: number;
  /** Scale correction in percent (100 = none). Use if a viewer shows the page slightly smaller/larger. */
  correction: number;
  tiling: 'board' | 'fill';
  boardW: number;
  boardH: number;
  showCodes: boolean;
  showGrid: boolean;
  majorEvery: number; // 0 = off
  beadStyle: 'round' | 'square';
  markEmpty: boolean;
  mirror: boolean;
  pageLegend: boolean;
  overviewPage: boolean;
  calibrationPage: boolean;
  title: string;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  pageSizeId: 'ipad-pro-11-m4',
  customW: 200,
  customH: 200,
  orientation: 'auto',
  pitch: 5,
  correction: 100,
  tiling: 'board',
  boardW: 29,
  boardH: 29,
  showCodes: true,
  showGrid: true,
  majorEvery: 10,
  beadStyle: 'round',
  markEmpty: true,
  mirror: false,
  pageLegend: true,
  overviewPage: true,
  calibrationPage: true,
  title: 'Pattern',
};

export interface Tile { x: number; y: number; w: number; h: number; col: number; row: number }

export interface PdfLayout {
  pageW: number;
  pageH: number;
  orientation: 'portrait' | 'landscape';
  margin: number;
  headerH: number;
  pitch: number;
  tileW: number;
  tileH: number;
  tiles: Tile[];
  tilesX: number;
  tilesY: number;
  warning?: string;
}

/** Short label for a color code, e.g. "H01" -> "01". */
export function shortCode(code: string): string {
  return code.replace(/^[A-Za-z]+(?=\d)/, '');
}

function layoutFor(pattern: Pattern, o: PdfOptions, pageW: number, pageH: number, isScreen: boolean): PdfLayout {
  const margin = isScreen ? 3 : 8;
  const headerH = 5;
  const pitch = o.pitch * (o.correction / 100);
  const colsFit = Math.max(1, Math.floor((pageW - 2 * margin) / pitch));
  const rowsFit = Math.max(1, Math.floor((pageH - 2 * margin - headerH) / pitch));
  let tileW = colsFit, tileH = rowsFit, warning: string | undefined;
  if (o.tiling === 'board') {
    const bx = Math.floor(colsFit / o.boardW), by = Math.floor(rowsFit / o.boardH);
    if (bx >= 1 && by >= 1) { tileW = bx * o.boardW; tileH = by * o.boardH; }
    else warning = `A ${o.boardW} x ${o.boardH} board does not fit on this page at ${o.pitch} mm; pages show ${colsFit} x ${rowsFit} pegs instead.`;
  }
  tileW = Math.min(tileW, pattern.width);
  tileH = Math.min(tileH, pattern.height);
  const tilesX = Math.ceil(pattern.width / tileW), tilesY = Math.ceil(pattern.height / tileH);
  const tiles: Tile[] = [];
  for (let r = 0; r < tilesY; r++)
    for (let c = 0; c < tilesX; c++) {
      const x = c * tileW, y = r * tileH;
      tiles.push({ x, y, w: Math.min(tileW, pattern.width - x), h: Math.min(tileH, pattern.height - y), col: c, row: r });
    }
  return {
    pageW, pageH, orientation: pageW > pageH ? 'landscape' : 'portrait', margin, headerH, pitch,
    tileW, tileH, tiles, tilesX, tilesY, warning,
  };
}

export function computeLayout(pattern: Pattern, o: PdfOptions): PdfLayout {
  const preset = PAGE_SIZES.find((p) => p.id === o.pageSizeId) ?? PAGE_SIZES[0];
  let w = preset.id === 'custom' ? o.customW : preset.w;
  let h = preset.id === 'custom' ? o.customH : preset.h;
  if (w > h) [w, h] = [h, w];
  const portrait = layoutFor(pattern, o, w, h, preset.screen);
  const landscape = layoutFor(pattern, o, h, w, preset.screen);
  if (o.orientation === 'portrait') return portrait;
  if (o.orientation === 'landscape') return landscape;
  if (portrait.tiles.length !== landscape.tiles.length) return portrait.tiles.length < landscape.tiles.length ? portrait : landscape;
  if (!!portrait.warning !== !!landscape.warning) return portrait.warning ? landscape : portrait;
  return landscape;
}

