import { useMemo, useState } from 'react';
import type { Palette } from '../lib/palette';
import type { Pattern } from '../lib/pattern';
import { BEAD_SIZES, computeLayout, DEFAULT_PDF_OPTIONS, PAGE_SIZES, type PdfOptions } from '../lib/pdf';
import { downloadBlob, safeFilename, storage } from '../lib/storage';
import { Check, Field, Modal, NumberInput, Select } from './ui';

interface Props { pattern: Pattern; palette: Palette; name: string; onClose: () => void }

export function ExportPdfDialog({ pattern, palette, name, onClose }: Props) {
  const [o, setO] = useState<PdfOptions>(() => storage.loadPdf(DEFAULT_PDF_OPTIONS));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PdfOptions>) => { const n = { ...o, ...patch }; setO(n); storage.savePdf(n); };
  const L = useMemo(() => computeLayout(pattern, o), [pattern, o]);
  const preset = PAGE_SIZES.find((p) => p.id === o.pageSizeId) ?? PAGE_SIZES[0];
  const extraPages = (o.overviewPage ? 1 : 0) + (o.calibrationPage ? 1 : 0);

  const build = (open: boolean) => {
    setBusy(true);
    // Let the UI paint the busy state first; jsPDF is loaded on demand
    setTimeout(async () => {
      try {
        const { generatePdf } = await import('../lib/pdf-render');
        const doc = generatePdf(pattern, palette, { ...o, title: name });
        const blob = doc.output('blob');
        if (open) {
          const url = URL.createObjectURL(blob);
          if (!window.open(url, '_blank')) downloadBlob(blob, safeFilename(name) + '.pdf');
        } else downloadBlob(blob, safeFilename(name) + '.pdf');
      } catch (e) {
        alert('PDF export failed: ' + e);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  // Page preview (first page of pattern)
  const scale = 220 / Math.max(L.pageW, L.pageH);
  const t0 = L.tiles[0];

  return (
    <Modal title="Export 1:1 PDF" onClose={onClose} wide>
      <div className="pdf-dialog">
        <div className="pdf-options">
          <Field label="Page size" hint={preset.screen ? 'The page is exactly the size of this iPad\'s screen, so viewing it full screen shows it at real size.' : 'Print at 100% / "Actual size" (not "Fit to page").'}>
            <Select value={o.pageSizeId} onChange={(pageSizeId) => set({ pageSizeId })} options={PAGE_SIZES.map((p) => ({ id: p.id, label: p.label }))} />
          </Field>
          {o.pageSizeId === 'custom' && (
            <div className="row">
              <Field label="Width (mm)"><NumberInput value={o.customW} min={30} max={2000} step={0.1} onChange={(customW) => set({ customW })} /></Field>
              <Field label="Height (mm)"><NumberInput value={o.customH} min={30} max={2000} step={0.1} onChange={(customH) => set({ customH })} /></Field>
            </div>
          )}
          <div className="row">
            <Field label="Orientation">
              <Select value={o.orientation} onChange={(orientation) => set({ orientation })} options={[
                { id: 'auto', label: 'Automatic' }, { id: 'landscape', label: 'Landscape' }, { id: 'portrait', label: 'Portrait' },
              ]} />
            </Field>
            <Field label="Bead size">
              <select value={BEAD_SIZES.find((b) => b.pitch === o.pitch)?.id ?? 'other'} onChange={(e) => { const b = BEAD_SIZES.find((b) => b.id === e.target.value); if (b) set({ pitch: b.pitch, boardW: b.board, boardH: b.board }); }}>
                {BEAD_SIZES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                <option value="other" disabled>Custom</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Peg spacing (mm)"><NumberInput value={o.pitch} min={1} max={30} step={0.01} onChange={(pitch) => set({ pitch })} /></Field>
            <Field label="Scale correction (%)" hint="Leave at 100 unless the scale check page measures wrong."><NumberInput value={o.correction} min={50} max={150} step={0.1} onChange={(correction) => set({ correction })} /></Field>
          </div>
          <Field label="Split pattern into pages">
            <Select value={o.tiling} onChange={(tiling) => set({ tiling })} options={[
              { id: 'board', label: 'By pegboard (whole boards per page)' }, { id: 'fill', label: 'As many pegs as fit' },
            ]} />
          </Field>
          {o.tiling === 'board' && (
            <div className="row">
              <Field label="Board width (pegs)"><NumberInput value={o.boardW} min={1} max={200} onChange={(boardW) => set({ boardW })} /></Field>
              <Field label="Board height (pegs)"><NumberInput value={o.boardH} min={1} max={200} onChange={(boardH) => set({ boardH })} /></Field>
            </div>
          )}
          <div className="check-grid">
            <Check checked={o.showCodes} onChange={(showCodes) => set({ showCodes })} label="Color codes on beads" />
            <Check checked={o.beadStyle === 'round'} onChange={(v) => set({ beadStyle: v ? 'round' : 'square' })} label="Round beads" />
            <Check checked={o.showGrid} onChange={(showGrid) => set({ showGrid })} label="Peg grid" />
            <Check checked={o.majorEvery > 0} onChange={(v) => set({ majorEvery: v ? 10 : 0 })} label="Heavier line every 10" />
            <Check checked={o.markEmpty} onChange={(markEmpty) => set({ markEmpty })} label="Dot on empty pegs" />
            <Check checked={o.pageLegend} onChange={(pageLegend) => set({ pageLegend })} label="Color list on each page" />
            <Check checked={o.overviewPage} onChange={(overviewPage) => set({ overviewPage })} label="Overview and bead count page" />
            <Check checked={o.calibrationPage} onChange={(calibrationPage) => set({ calibrationPage })} label="Scale check page" />
            <Check checked={o.mirror} onChange={(mirror) => set({ mirror })} label="Mirror (build from the back)" />
          </div>
        </div>

        <div className="pdf-summary">
          <svg width={L.pageW * scale + 2} height={L.pageH * scale + 2} className="page-preview">
            <rect x={1} y={1} width={L.pageW * scale} height={L.pageH * scale} fill="#fff" stroke="#999" />
            {t0 && (
              <rect x={1 + L.margin * scale} y={1 + (L.margin + L.headerH) * scale} width={t0.w * L.pitch * scale} height={t0.h * L.pitch * scale}
                fill="#cfe3ff" stroke="#246" strokeWidth={0.8} />
            )}
            {t0 && o.tiling === 'board' && Array.from({ length: Math.ceil(t0.w / o.boardW) - 1 }, (_, i) => (
              <line key={'v' + i} x1={1 + (L.margin + (i + 1) * o.boardW * L.pitch) * scale} x2={1 + (L.margin + (i + 1) * o.boardW * L.pitch) * scale}
                y1={1 + (L.margin + L.headerH) * scale} y2={1 + (L.margin + L.headerH + t0.h * L.pitch) * scale} stroke="#246" strokeWidth={0.8} />
            ))}
            {t0 && o.tiling === 'board' && Array.from({ length: Math.ceil(t0.h / o.boardH) - 1 }, (_, i) => (
              <line key={'h' + i} y1={1 + (L.margin + L.headerH + (i + 1) * o.boardH * L.pitch) * scale} y2={1 + (L.margin + L.headerH + (i + 1) * o.boardH * L.pitch) * scale}
                x1={1 + L.margin * scale} x2={1 + (L.margin + t0.w * L.pitch) * scale} stroke="#246" strokeWidth={0.8} />
            ))}
          </svg>
          <ul className="small">
            <li>Page: {L.pageW.toFixed(1)} x {L.pageH.toFixed(1)} mm, {L.orientation}</li>
            <li>Pattern: {pattern.width} x {pattern.height} pegs = {(pattern.width * o.pitch / 10).toFixed(1)} x {(pattern.height * o.pitch / 10).toFixed(1)} cm</li>
            <li>Up to {L.tileW} x {L.tileH} pegs per page</li>
            <li>{L.tiles.length} pattern page{L.tiles.length > 1 ? 's' : ''} ({L.tilesX} x {L.tilesY}){extraPages ? ` + ${extraPages} info page${extraPages > 1 ? 's' : ''}` : ''}</li>
          </ul>
          {L.warning && <p className="warn small">{L.warning}</p>}
          {preset.screen && (
            <p className="muted small">
              On the iPad: open the PDF in Files or Books, view it full screen in the same orientation as the page, and don't zoom.
              Lay the clear pegboard over the grid and line it up with the board outline. Check the scale page first.
            </p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={() => { setO(DEFAULT_PDF_OPTIONS); storage.savePdf(DEFAULT_PDF_OPTIONS); }}>Reset</button>
        <span className="spacer" />
        <button onClick={() => build(true)} disabled={busy}>Open</button>
        <button className="primary" onClick={() => build(false)} disabled={busy}>{busy ? 'Building...' : 'Download PDF'}</button>
      </div>
    </Modal>
  );
}
