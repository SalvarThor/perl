import { useMemo, useRef, useState } from 'react';
import { contrastText } from '../lib/color';
import { parseCustomPalette, type Palette } from '../lib/palette';
import { shortCode } from '../lib/pdf';
import { downloadBlob, safeFilename } from '../lib/storage';
import { Modal } from './ui';

interface Props {
  palettes: Palette[];
  owned: Record<string, string[]>;
  onOwned: (paletteId: string, codes: string[] | undefined) => void;
  onAddPalette: (p: Palette) => void;
  onDeletePalette: (id: string) => void;
  initialId: string;
}

export function PaletteManager({ palettes, owned, onOwned, onAddPalette, onDeletePalette, initialId }: Props) {
  const [id, setId] = useState(initialId);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'owned' | 'missing'>('all');
  const [importOpen, setImportOpen] = useState(false);
  const palette = palettes.find((p) => p.id === id) ?? palettes[0];
  const ownedList = owned[palette.id];
  const ownedSet = useMemo(() => new Set(ownedList ?? palette.colors.map((c) => c.code)), [ownedList, palette]);

  const toggle = (code: string) => {
    const s = new Set(ownedSet);
    if (s.has(code)) s.delete(code); else s.add(code);
    onOwned(palette.id, palette.colors.map((c) => c.code).filter((c) => s.has(c)));
  };
  const setAll = (pred: (c: Palette['colors'][number]) => boolean) =>
    onOwned(palette.id, palette.colors.filter(pred).map((c) => c.code));

  const q = search.trim().toLowerCase();
  const list = palette.colors.filter((c) =>
    (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) &&
    (show === 'all' || (show === 'owned') === ownedSet.has(c.code)));

  return (
    <div className="palettes page">
      <div className="page-head">
        <select value={palette.id} onChange={(e) => setId(e.target.value)}>
          {palettes.map((p) => <option key={p.id} value={p.id}>{p.name}{p.custom ? ' (custom)' : ''}</option>)}
        </select>
        <span className="muted">{palette.colors.length} colors, {ownedList ? `${ownedList.length} owned` : 'owned colors not set (all are used)'}</span>
        <span className="spacer" />
        <button onClick={() => setImportOpen(true)}>Import palette...</button>
        {palette.custom && <button onClick={() => { if (confirm(`Delete palette "${palette.name}"?`)) { onDeletePalette(palette.id); setId(palettes[0].id); } }}>Delete palette</button>}
      </div>
      <p className="muted small">
        Tap colors to mark which ones you own. Then turn on "Only colors I own" in the generator. Discontinued colors are only used by the generator if you mark them as owned.
        {palette.source && <> Color values: {palette.source}</>}
      </p>
      <div className="row wrap">
        <button onClick={() => setAll(() => true)}>Own all</button>
        <button onClick={() => setAll(() => false)}>Own none</button>
        <button onClick={() => setAll((c) => !c.effect && !c.discontinued)}>Current solid colors</button>
        {ownedList && <button onClick={() => onOwned(palette.id, undefined)} title="Forget owned colors for this palette">Reset</button>}
        <button onClick={() => downloadBlob(new Blob([[...ownedSet].join('\n')], { type: 'text/plain' }), safeFilename(palette.name) + '-owned.txt')}>Export owned list</button>
        <span className="spacer" />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="all">Show all</option>
          <option value="owned">Owned</option>
          <option value="missing">Not owned</option>
        </select>
        <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="owned-grid">
        {list.map((c) => {
          const on = ownedSet.has(c.code);
          return (
            <button key={c.code} className={'owned-card' + (on ? ' on' : '')} onClick={() => toggle(c.code)} title={c.hex}>
              <span className="owned-swatch" style={{ background: c.hex, color: contrastText(c.hex) }}>{shortCode(c.code)}{c.effect && <small> fx</small>}</span>
              <span className="owned-name"><b>{c.code}</b> {c.name}{c.discontinued && <span className="muted"> (discontinued)</span>}{c.approx && <span className="muted"> (approx. color)</span>}</span>
              <span className="owned-check">{on ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
      {importOpen && <ImportPaletteDialog onClose={() => setImportOpen(false)} onImport={(p) => { onAddPalette(p); setId(p.id); setImportOpen(false); }} />}
    </div>
  );
}

function ImportPaletteDialog({ onClose, onImport }: { onClose: () => void; onImport: (p: Palette) => void }) {
  const [name, setName] = useState('My palette');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const go = () => {
    try { onImport(parseCustomPalette(text, name)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  return (
    <Modal title="Import palette" onClose={onClose}>
      <p className="muted small">Paste CSV lines of <code>code,name,#RRGGBB</code> (optionally a 4th column "effect"), or JSON. You can also load a file.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Palette name" />
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'01,White,#FFFFFF\n02,Black,#000000'} />
      <input ref={file} type="file" accept=".csv,.txt,.json,.tsv" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) { setText(await f.text()); setName(f.name.replace(/\.[^.]+$/, '')); }
      }} />
      {err && <p className="error small">{err}</p>}
      <div className="modal-actions">
        <button onClick={() => file.current?.click()}>Load file...</button>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={go} disabled={!text.trim()}>Import</button>
      </div>
    </Modal>
  );
}
