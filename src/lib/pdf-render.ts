import { jsPDF } from 'jspdf';
import { contrastText, hexToRgb } from './color';
import type { Palette } from './palette';
import { colorCounts, flip, type Pattern } from './pattern';
import { computeLayout, shortCode, type PdfOptions, type Tile } from './pdf';

// Separate module so jsPDF is only loaded when exporting.

type Doc = jsPDF;

function setFill(doc: Doc, hex: string) { const [r, g, b] = hexToRgb(hex); doc.setFillColor(r, g, b); }
function setDraw(doc: Doc, hex: string) { const [r, g, b] = hexToRgb(hex); doc.setDrawColor(r, g, b); }
function setText(doc: Doc, hex: string) { const [r, g, b] = hexToRgb(hex); doc.setTextColor(r, g, b); }

function drawLegend(
  doc: Doc, palette: Palette, counts: [number, number][], x: number, y: number, w: number, h: number, rowH = 4.2,
): number {
  // returns number of entries drawn
  doc.setFont('helvetica', 'normal');
  const colW = Math.max(38, Math.min(60, w));
  const cols = Math.max(1, Math.floor(w / colW));
  const rows = Math.max(1, Math.floor(h / rowH));
  const n = Math.min(counts.length, cols * rows);
  const fs = rowH * 2.0; // pt
  doc.setFontSize(fs);
  for (let i = 0; i < n; i++) {
    const [ci, count] = counts[i];
    const c = palette.colors[ci];
    const cx = x + Math.floor(i / rows) * colW, cy = y + (i % rows) * rowH;
    setFill(doc, c.hex);
    setDraw(doc, '#888888');
    doc.setLineWidth(0.1);
    doc.circle(cx + rowH * 0.4, cy + rowH * 0.45, rowH * 0.36, 'FD');
    setText(doc, '#000000');
    const label = `${c.code} ${c.name}`;
    const maxW = colW - rowH - 12;
    let txt = label;
    while (doc.getTextWidth(txt) > maxW && txt.length > 4) txt = txt.slice(0, -2) + '.';
    doc.text(txt, cx + rowH * 0.95, cy + rowH * 0.62);
    doc.text(String(count), cx + colW - 3, cy + rowH * 0.62, { align: 'right' });
  }
  return n;
}

function sortedCounts(pattern: Pattern, region?: Tile): [number, number][] {
  let m: Map<number, number>;
  if (!region) m = colorCounts(pattern);
  else {
    m = new Map();
    for (let y = region.y; y < region.y + region.h; y++)
      for (let x = region.x; x < region.x + region.w; x++) {
        const c = pattern.cells[y * pattern.width + x];
        if (c >= 0) m.set(c, (m.get(c) ?? 0) + 1);
      }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function drawRuler(doc: Doc, x: number, y: number, lengthMm: number, k: number) {
  setDraw(doc, '#000000');
  setText(doc, '#000000');
  doc.setLineWidth(0.2);
  doc.line(x, y, x + lengthMm * k, y);
  doc.setFontSize(6);
  for (let mm = 0; mm <= lengthMm; mm++) {
    const t = mm % 10 === 0 ? 3 : mm % 5 === 0 ? 2 : 1;
    doc.line(x + mm * k, y, x + mm * k, y - t);
    if (mm % 10 === 0) doc.text(String(mm / 10), x + mm * k, y + 2.8, { align: 'center' });
  }
  doc.text('cm', x + lengthMm * k + 2, y + 0.5);
}

export function generatePdf(source: Pattern, palette: Palette, o: PdfOptions): jsPDF {
  const pattern = o.mirror ? flip(source, true) : source;
  const L = computeLayout(pattern, o);
  const doc = new jsPDF({ unit: 'mm', format: [L.pageW, L.pageH], orientation: L.orientation, compress: true });
  const k = o.correction / 100;
  const p = L.pitch;
  const totalBeads = [...colorCounts(pattern).values()].reduce((a, b) => a + b, 0);
  const counts = sortedCounts(pattern);
  let first = true;
  const newPage = () => { if (!first) doc.addPage([L.pageW, L.pageH], L.orientation); first = false; };
  const boardNameOf = (t: Tile) => (L.tiles.length > 1 ? `Section ${String.fromCharCode(65 + (t.row % 26))}${t.col + 1}` : 'Pattern');

  // ---- overview page ----
  if (o.overviewPage) {
    newPage();
    const m = L.margin + 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    setText(doc, '#000000');
    doc.text(o.title || 'Pattern', m, m + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const info = `${pattern.width} x ${pattern.height} pegs  |  ${(pattern.width * o.pitch / 10).toFixed(1)} x ${(pattern.height * o.pitch / 10).toFixed(1)} cm  |  ${totalBeads} beads  |  ${counts.length} colors  |  ${palette.name}  |  ${L.tiles.length} page${L.tiles.length > 1 ? 's' : ''}`;
    doc.text(info, m, m + 10);
    const top = m + 14;
    // thumbnail + section map
    const legendW = Math.min(L.pageW * 0.45, 125);
    const thumbMaxW = L.pageW - 2 * m - legendW - 6;
    const thumbMaxH = L.pageH - top - m;
    const s = Math.min(thumbMaxW / pattern.width, thumbMaxH / pattern.height);
    for (let y = 0; y < pattern.height; y++)
      for (let x = 0; x < pattern.width; x++) {
        const c = pattern.cells[y * pattern.width + x];
        if (c < 0) continue;
        setFill(doc, palette.colors[c].hex);
        doc.rect(m + x * s, top + y * s, s + 0.01, s + 0.01, 'F');
      }
    setDraw(doc, '#000000');
    doc.setLineWidth(0.2);
    doc.rect(m, top, pattern.width * s, pattern.height * s, 'S');
    if (L.tiles.length > 1) {
      doc.setLineWidth(0.4);
      setDraw(doc, '#E00000');
      doc.setFontSize(Math.max(5, Math.min(12, L.tileW * s * 0.8)));
      for (const t of L.tiles) {
        const tx = t.x;
        doc.rect(m + tx * s, top + t.y * s, t.w * s, t.h * s, 'S');
        setText(doc, '#E00000');
        doc.text(boardNameOf(t).replace('Section ', ''), m + (tx + t.w / 2) * s, top + (t.y + t.h / 2) * s, { align: 'center', baseline: 'middle' });
      }
    }
    // legend
    setText(doc, '#000000');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const lx = L.pageW - m - legendW;
    doc.text('Colors (bead count)', lx, top + 2);
    let drawn = drawLegend(doc, palette, counts, lx, top + 4, legendW, L.pageH - top - 4 - m);
    while (drawn < counts.length) {
      newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(doc, '#000000');
      doc.text('Colors (continued)', m, m + 4);
      drawn += drawLegend(doc, palette, counts.slice(drawn), m, m + 7, L.pageW - 2 * m, L.pageH - 2 * m - 7);
    }
  }

  // ---- calibration page ----
  if (o.calibrationPage) {
    newPage();
    const m = L.margin + 2;
    setText(doc, '#000000');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Scale check', m, m + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const lines = [
      'Measure the ruler below, or lay your pegboard over the row of beads.',
      'If it is off, set "Scale correction" to (real length / shown length) x 100 and export again.',
      'iPad: open the PDF in Files or Books, view full screen and do not zoom.',
    ];
    lines.forEach((t, i) => doc.text(t, m, m + 10 + i * 3.5));
    const rulerLen = Math.min(100, Math.floor((L.pageW - 2 * m - 10) / 10) * 10);
    drawRuler(doc, m, m + 26, rulerLen, k);
    doc.text(`${rulerLen / 10} cm`, m, m + 33);
    const n = Math.max(2, Math.min(20, Math.floor((L.pageW - 2 * m) / p)));
    const by = m + 40;
    for (let i = 0; i < n; i++) {
      setFill(doc, i % 2 ? '#3070D0' : '#E03030');
      doc.circle(m + p * (i + 0.5), by + p / 2, p * 0.45, 'F');
      setFill(doc, '#FFFFFF');
      doc.circle(m + p * (i + 0.5), by + p / 2, p * 0.15, 'F');
    }
    setText(doc, '#000000');
    doc.text(`${n} pegs at ${o.pitch} mm = ${(n * o.pitch).toFixed(1)} mm`, m, by + p + 4);
  }

  // ---- pattern pages ----
  const labels = palette.colors.map((c) => shortCode(c.code));
  const textColors = palette.colors.map((c) => contrastText(c.hex));
  const rgbs = palette.colors.map((c) => hexToRgb(c.hex));
  L.tiles.forEach((t, ti) => {
    newPage();
    const ox = L.margin, oy = L.margin + L.headerH;
    // Header
    setText(doc, '#000000');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const tx0 = t.x;
    const head = `${o.title ? o.title + '  -  ' : ''}${boardNameOf(t)}  (${ti + 1}/${L.tiles.length})`;
    doc.text(head, ox, L.margin + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(`columns ${tx0 + 1}-${tx0 + t.w}, rows ${t.y + 1}-${t.y + t.h}${o.mirror ? ', mirrored' : ''}`,
      ox + doc.getTextWidth(head) * (8 / 6.5) + 4, L.margin + 3);

    // Beads
    const fontPt = Math.max(3, p * 1.1 * (labels.some((l) => l.length > 2) ? 0.85 : 1));
    doc.setFontSize(fontPt);
    for (let yy = 0; yy < t.h; yy++)
      for (let xx = 0; xx < t.w; xx++) {
        const px = t.x + xx;
        const c = pattern.cells[(t.y + yy) * pattern.width + px];
        const cx = ox + (xx + 0.5) * p, cy = oy + (yy + 0.5) * p;
        if (c < 0) {
          if (o.markEmpty) { doc.setFillColor(190, 190, 190); doc.circle(cx, cy, Math.max(0.15, p * 0.06), 'F'); }
          continue;
        }
        const [r, g, b] = rgbs[c];
        doc.setFillColor(r, g, b);
        if (o.beadStyle === 'round') {
          doc.setDrawColor(Math.max(0, r - 60), Math.max(0, g - 60), Math.max(0, b - 60));
          doc.setLineWidth(Math.max(0.05, p * 0.02));
          doc.circle(cx, cy, p * 0.46, 'FD');
        } else {
          doc.rect(ox + xx * p, oy + yy * p, p, p, 'F');
        }
        if (o.showCodes && p >= 2.4) {
          setText(doc, textColors[c]);
          doc.text(labels[c], cx, cy, { align: 'center', baseline: 'middle' });
        }
      }

    // Grid lines
    const gw = t.w * p, gh = t.h * p;
    if (o.showGrid) {
      doc.setLineWidth(0.05);
      doc.setDrawColor(170, 170, 170);
      for (let i = 0; i <= t.w; i++) doc.line(ox + i * p, oy, ox + i * p, oy + gh);
      for (let i = 0; i <= t.h; i++) doc.line(ox, oy + i * p, ox + gw, oy + i * p);
    }
    if (o.majorEvery > 0) {
      doc.setLineWidth(0.18);
      doc.setDrawColor(90, 90, 90);
      for (let i = 0; i <= t.w; i++) if ((tx0 + i) % o.majorEvery === 0) doc.line(ox + i * p, oy, ox + i * p, oy + gh);
      for (let i = 0; i <= t.h; i++) if ((t.y + i) % o.majorEvery === 0) doc.line(ox, oy + i * p, ox + gw, oy + i * p);
    }
    // Board outlines
    doc.setLineWidth(0.35);
    doc.setDrawColor(0, 0, 0);
    if (o.tiling === 'board') {
      for (let by = 0; by < t.h; by += o.boardH)
        for (let bx = 0; bx < t.w; bx += o.boardW)
          doc.rect(ox + bx * p, oy + by * p, Math.min(o.boardW, t.w - bx) * p, Math.min(o.boardH, t.h - by) * p, 'S');
    } else doc.rect(ox, oy, gw, gh, 'S');

    // Per-page legend in leftover space
    if (o.pageLegend) {
      const tc = sortedCounts(pattern, t);
      const rightW = L.pageW - (ox + gw) - 4 - L.margin;
      const belowH = L.pageH - (oy + gh) - 3 - L.margin;
      if (rightW >= 34) drawLegend(doc, palette, tc, ox + gw + 4, oy, rightW, L.pageH - oy - L.margin, 3.6);
      else if (belowH >= 8) drawLegend(doc, palette, tc, ox, oy + gh + 3, L.pageW - 2 * L.margin, belowH, 3.6);
    }
  });
  return doc;
}
