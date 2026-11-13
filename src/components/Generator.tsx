import { useEffect, useMemo, useRef, useState } from 'react';
import { METRICS } from '../lib/color';
import { allowedColors, type GenerateResult, type GenerateSettings } from '../lib/generate';
import { loadImageFile, RESAMPLE_METHODS, type SourceImage } from '../lib/image';
import type { Palette } from '../lib/palette';
import { colorCounts, newId, type Project } from '../lib/pattern';
import { DITHER_METHODS } from '../lib/quantize';
import type { WorkerRequest } from '../lib/worker';
import { PatternCanvas, type ViewOptions } from './PatternCanvas';
import { Check, Field, NumberInput, Section, Select, Slider } from './ui';

interface Props {
  palettes: Palette[];
  owned: Record<string, string[]>;
  settings: GenerateSettings;
  onSettings: (s: GenerateSettings) => void;
  onCreate: (p: Project) => void;
  onManagePalettes: () => void;
}

const BOARD = 29;

export function Generator({ palettes, owned, settings: s, onSettings, onCreate, onManagePalettes }: Props) {
  const [image, setImage] = useState<SourceImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const palette = palettes.find((p) => p.id === s.paletteId) ?? palettes[0];
  const ownedCodes = owned[palette.id];
  const set = (patch: Partial<GenerateSettings>) => onSettings({ ...s, ...patch });
  const setSize = (patch: Partial<GenerateSettings['size']>) => onSettings({ ...s, size: { ...s.size, ...patch } });
  const setAdj = (patch: Partial<GenerateSettings['adjustments']>) => onSettings({ ...s, adjustments: { ...s.adjustments, ...patch } });

  useEffect(() => {
    const w = new Worker(new URL('../lib/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const msg = e.data as { id: number; ok: boolean; result?: GenerateResult; error?: string };
      if (msg.id !== reqId.current) return;
      setBusy(false);
      if (msg.ok) { setResult(msg.result!); setError(null); } else setError(msg.error ?? 'Failed');
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const loadFile = async (file: File) => {
    try {
      setError(null);
      const img = await loadImageFile(file, file.name);
      workerRef.current?.postMessage({ type: 'image', image: img } satisfies WorkerRequest);
      setImage(img);
      setImageUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
      setName(file.name.replace(/\.[^.]+$/, ''));
      setResult(null);
    } catch (e) {
      setError('Could not read that image: ' + e);
    }
  };

  // Paste support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (f) loadFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Regenerate (debounced) when inputs change
  useEffect(() => {
    if (!image || !workerRef.current) return;
    const t = setTimeout(() => {
      const id = ++reqId.current;
      setBusy(true);
      workerRef.current!.postMessage({ type: 'generate', id, palette, owned: ownedCodes, settings: s } satisfies WorkerRequest);
    }, 180);
    return () => clearTimeout(t);
  }, [image, s, palette, ownedCodes]);

  const allowed = useMemo(() => allowedColors(palette, s, ownedCodes), [palette, s, ownedCodes]);
  const pattern = useMemo(() => result ? { width: result.width, height: result.height, cells: result.cells } : null, [result]);
  const counts = useMemo(() => pattern ? [...colorCounts(pattern).entries()].sort((a, b) => b[1] - a[1]) : [], [pattern]);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const view: ViewOptions = useMemo(() => ({ style: 'round', grid: false, boardSize: BOARD, codes: false, highlight: null }), []);

  const create = () => {
    if (!pattern) return;
    const now = Date.now();
    onCreate({
      id: newId(), name: name || 'Untitled', paletteId: palette.id,
      pattern: { width: pattern.width, height: pattern.height, cells: pattern.cells.slice() },
      createdAt: now, updatedAt: now,
    });
  };

  const boardsW = pattern ? Math.ceil(pattern.width / BOARD) : 0;
  const boardsH = pattern ? Math.ceil(pattern.height / BOARD) : 0;
  const ownedConfigured = !!ownedCodes;
  const hasExcluded = s.excluded.length > 0;

  return (
    <div className="generator">
      <aside className="panel settings">
        <Section title="Image">
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
          <button className="primary block" onClick={() => fileInput.current?.click()}>{image ? 'Choose another image' : 'Choose image'}</button>
          {image && <p className="muted small">{image.name}: {image.width} x {image.height} px</p>}
          <p className="muted small">You can also drop or paste an image.</p>
        </Section>

        <Section title="Size">
          <Field label="Sizing">
            <Select value={s.size.mode} onChange={(mode) => setSize({ mode })} options={[
              { id: 'auto', label: 'Automatic' },
              { id: 'width', label: 'Fixed width' },
              { id: 'height', label: 'Fixed height' },
              { id: 'fit', label: 'Fit within W x H' },
              { id: 'exact', label: 'Exact W x H' },
            ]} />
          </Field>
          {s.size.mode === 'auto' && (
            <>
              <Field label="Longest side for photos (beads)"><NumberInput value={s.size.autoMax} min={4} max={500} onChange={(autoMax) => setSize({ autoMax })} /></Field>
              <Check checked={s.detectPixelArt} onChange={(detectPixelArt) => set({ detectPixelArt })} label="Detect pixel art and use its native size" />
            </>
          )}
          {s.size.mode !== 'auto' && (
            <div className="row">
              {s.size.mode !== 'height' && <Field label="Width"><NumberInput value={s.size.width} min={1} max={500} onChange={(width) => setSize({ width })} /></Field>}
              {s.size.mode !== 'width' && <Field label="Height"><NumberInput value={s.size.height} min={1} max={500} onChange={(height) => setSize({ height })} /></Field>}
            </div>
          )}
          {s.size.mode === 'exact' && (
            <Field label="If the aspect ratio differs">
              <Select value={s.size.aspect} onChange={(aspect) => setSize({ aspect })} options={[
                { id: 'crop', label: 'Crop to fill' }, { id: 'pad', label: 'Fit and leave empty pegs' }, { id: 'stretch', label: 'Stretch' },
              ]} />
            </Field>
          )}
          <div className="chips">
            <span className="muted small">Boards (29 x 29):</span>
            {[[1, 1], [2, 1], [2, 2], [3, 3], [4, 4]].map(([a, b]) => (
              <button key={a + 'x' + b} className="chip" onClick={() => setSize({ mode: 'fit', width: a * BOARD, height: b * BOARD })}>{a}x{b}</button>
            ))}
          </div>
          <Field label="Resampling">
            <Select value={s.resample} onChange={(resample) => set({ resample })} options={RESAMPLE_METHODS} />
          </Field>
        </Section>

        <Section title="Colors">
          <Field label="Palette">
            <Select value={palette.id} onChange={(paletteId) => set({ paletteId, excluded: [] })} options={palettes.map((p) => ({ id: p.id, label: p.name }))} />
          </Field>
          <Check checked={s.ownedOnly} onChange={(ownedOnly) => set({ ownedOnly })} label={`Only colors I own${ownedConfigured ? ` (${ownedCodes!.length})` : ''}`} />
          {s.ownedOnly && !ownedConfigured && <p className="warn small">You have not marked owned colors for this palette yet, so all colors are used. <a href="#" onClick={(e) => { e.preventDefault(); onManagePalettes(); }}>Set owned colors</a></p>}
          <Check checked={s.includeEffects} onChange={(includeEffects) => set({ includeEffects })} label="Include effect colors (neon, glitter, glow, translucent...)" />
          <Field label="Maximum colors" hint="0 = no limit. The best subset is chosen for this image.">
            <NumberInput value={s.maxColors} min={0} max={300} onChange={(maxColors) => set({ maxColors })} />
          </Field>
          <Field label="Color matching">
            <Select value={s.metric} onChange={(metric) => set({ metric })} options={METRICS} />
          </Field>
          <p className="muted small">{allowed.length} colors available{hasExcluded && <> ({s.excluded.length} excluded, <a href="#" onClick={(e) => { e.preventDefault(); set({ excluded: [] }); }}>reset</a>)</>}</p>
        </Section>

        <Section title="Dithering">
          <Field label="Method">
            <Select value={s.dither} onChange={(dither) => set({ dither })} options={DITHER_METHODS} />
          </Field>
          {s.dither !== 'none' && (
            <>
              <Field label="Strength"><Slider value={s.ditherStrength} min={0} max={1} step={0.05} onChange={(ditherStrength) => set({ ditherStrength })} format={(v) => Math.round(v * 100) + '%'} /></Field>
              {!s.dither.startsWith('bayer') && <Check checked={s.serpentine} onChange={(serpentine) => set({ serpentine })} label="Serpentine scan (fewer artifacts)" />}
            </>
          )}
        </Section>

        <Section title="Adjustments" defaultOpen={false}>
          <Field label="Brightness"><Slider value={s.adjustments.brightness} min={-100} max={100} onChange={(brightness) => setAdj({ brightness })} /></Field>
          <Field label="Contrast"><Slider value={s.adjustments.contrast} min={-100} max={100} onChange={(contrast) => setAdj({ contrast })} /></Field>
          <Field label="Saturation"><Slider value={s.adjustments.saturation} min={-100} max={100} onChange={(saturation) => setAdj({ saturation })} /></Field>
          <Field label="Gamma"><Slider value={s.adjustments.gamma} min={0.3} max={2.5} step={0.05} onChange={(gamma) => setAdj({ gamma })} format={(v) => v.toFixed(2)} /></Field>
          <button onClick={() => setAdj({ brightness: 0, contrast: 0, saturation: 0, gamma: 1 })}>Reset adjustments</button>
        </Section>

        <Section title="Background and cleanup" defaultOpen={false}>
          <Check checked={s.removeBg} onChange={(removeBg) => set({ removeBg })} label="Remove background (from the edges)" />
          {s.removeBg && <Field label="Background tolerance"><Slider value={s.bgTolerance} min={0} max={160} onChange={(bgTolerance) => set({ bgTolerance })} /></Field>}
          <Field label="Transparency threshold" hint="Pixels more transparent than this become empty pegs">
            <Slider value={s.alphaThreshold} min={1} max={255} onChange={(alphaThreshold) => set({ alphaThreshold })} />
          </Field>
          <Field label="Drop colors used fewer than N times" hint="0 = off. Avoids buying a bag for 2 beads.">
            <NumberInput value={s.minBeadsPerColor} min={0} max={500} onChange={(minBeadsPerColor) => set({ minBeadsPerColor })} />
          </Field>
          <Check checked={s.removeIsolated} onChange={(removeIsolated) => set({ removeIsolated })} label="Remove stray single beads" />
        </Section>
      </aside>

      <section
        className={'preview' + (dragOver ? ' drag' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/')); if (f) loadFile(f); }}
      >
        {!image && (
          <div className="empty-state" onClick={() => fileInput.current?.click()}>
            <h2>Create a pattern from an image</h2>
            <p>Choose, drop or paste an image. Pixel art, logos and simple illustrations work best; photos work well with dithering.</p>
            <button className="primary">Choose image</button>
          </div>
        )}
        {image && (
          <div className="preview-panes">
            <div className="pane source">
              <div className="pane-title">Original</div>
              {imageUrl && <img src={imageUrl} alt="source" />}
            </div>
            <div className="pane result">
              <div className="pane-title">
                Pattern {busy && <span className="spinner" />}
                {result && <span className="muted"> {result.width} x {result.height} ({boardsW} x {boardsH} boards), {total} beads, {result.usedColors} colors, {result.ms} ms</span>}
              </div>
              {pattern && <PatternCanvas pattern={pattern} palette={palette} view={view} />}
              {result && <div className="muted small reason">{result.reason}</div>}
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="result-bar">
            <div className="used-colors" title="Tap a color to exclude it and regenerate">
              {counts.map(([ci, n]) => {
                const c = palette.colors[ci];
                return (
                  <button key={ci} className="swatch-chip" onClick={() => set({ excluded: [...s.excluded, c.code] })} title={`${c.code} ${c.name}: ${n} beads. Tap to exclude.`}>
                    <span className="swatch" style={{ background: c.hex }} />{c.code} <span className="muted">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="create-row">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pattern name" />
              <button className="primary" onClick={create} disabled={!pattern || busy}>Open in editor</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
