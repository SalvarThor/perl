import { useEffect, useRef, useState } from 'react';
import { hexToRgb } from '../lib/color';
import type { Palette } from '../lib/palette';
import { deserializeProject, emptyPattern, newId, type Project, type SerializedProject } from '../lib/pattern';
import { downloadBlob, safeFilename } from '../lib/storage';
import { Field, Modal, NumberInput } from './ui';

interface Props {
  projects: SerializedProject[];
  palettes: Palette[];
  currentId: string | null;
  onOpen: (p: Project) => void;
  onDelete: (id: string) => void;
  onImport: (p: Project) => void;
  defaultPaletteId: string;
}

function Thumb({ s, palettes }: { s: SerializedProject; palettes: Palette[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const pal = palettes.find((p) => p.id === s.paletteId);
    c.width = s.width; c.height = s.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(s.width, s.height);
    const byCode = new Map(pal?.colors.map((x) => [x.code, hexToRgb(x.hex)]) ?? []);
    const rgb = s.codes.map((code) => byCode.get(code) ?? [255, 0, 255]);
    s.cells.forEach((v, i) => {
      if (v < 0) return;
      const [r, g, b] = rgb[v];
      img.data.set([r, g, b, 255], i * 4);
    });
    ctx.putImageData(img, 0, 0);
  }, [s, palettes]);
  return <canvas ref={ref} className="thumb" />;
}

export function Projects({ projects, palettes, currentId, onOpen, onDelete, onImport, defaultPaletteId }: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  const open = (s: SerializedProject) => {
    try {
      const { project, missing } = deserializeProject(s, palettes);
      if (missing.length) alert(`These colors are not in the palette and were removed: ${missing.join(', ')}`);
      onOpen(project);
    } catch (e) { alert(String(e)); }
  };

  const importFiles = async (files: FileList) => {
    for (const f of files) {
      try {
        const s = JSON.parse(await f.text()) as SerializedProject;
        const { project, missing } = deserializeProject(s, palettes);
        if (projects.some((p) => p.id === project.id)) project.id = newId();
        if (missing.length) alert(`${f.name}: colors not in palette were removed: ${missing.join(', ')}`);
        onImport(project);
      } catch (e) { alert(`${f.name}: ${e}`); }
    }
  };

  return (
    <div className="projects page">
      <div className="page-head">
        <h2>Patterns</h2>
        <span className="spacer" />
        <button onClick={() => setNewOpen(true)}>New blank pattern</button>
        <button onClick={() => file.current?.click()}>Import pattern file...</button>
        <input ref={file} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {!sorted.length && <p className="muted">No saved patterns yet. Generate one from an image or start a blank pattern.</p>}
      <div className="project-grid">
        {sorted.map((s) => (
          <div key={s.id} className={'project-card' + (s.id === currentId ? ' current' : '')}>
            <button className="thumb-btn" onClick={() => open(s)}><Thumb s={s} palettes={palettes} /></button>
            <div className="project-info">
              <b>{s.name}</b>
              <span className="muted small">{s.width} x {s.height}, {s.codes.length} colors, {palettes.find((p) => p.id === s.paletteId)?.name ?? s.paletteId}</span>
              <span className="muted small">{new Date(s.updatedAt).toLocaleString()}</span>
            </div>
            <div className="row">
              <button onClick={() => open(s)}>Open</button>
              <button onClick={() => {
                const { project } = deserializeProject(s, palettes);
                onImport({ ...project, id: newId(), name: s.name + ' copy', createdAt: Date.now(), updatedAt: Date.now() });
              }}>Duplicate</button>
              <button onClick={() => downloadBlob(new Blob([JSON.stringify(s)], { type: 'application/json' }), safeFilename(s.name) + '.perler.json')}>Export</button>
              <button className="danger" onClick={() => { if (confirm(`Delete "${s.name}"?`)) onDelete(s.id); }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {newOpen && <NewPatternDialog palettes={palettes} defaultPaletteId={defaultPaletteId} onClose={() => setNewOpen(false)}
        onCreate={(p) => { setNewOpen(false); onImport(p); onOpen(p); }} />}
    </div>
  );
}

function NewPatternDialog({ palettes, defaultPaletteId, onClose, onCreate }: {
  palettes: Palette[]; defaultPaletteId: string; onClose: () => void; onCreate: (p: Project) => void;
}) {
  const [w, setW] = useState(29);
  const [h, setH] = useState(29);
  const [pid, setPid] = useState(defaultPaletteId);
  const [name, setName] = useState('New pattern');
  return (
    <Modal title="New blank pattern" onClose={onClose}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="row">
        <Field label="Width"><NumberInput value={w} min={1} max={500} onChange={setW} /></Field>
        <Field label="Height"><NumberInput value={h} min={1} max={500} onChange={setH} /></Field>
      </div>
      <div className="chips">
        {[[1, 1], [2, 1], [2, 2], [3, 3]].map(([a, b]) => <button key={a + 'x' + b} className="chip" onClick={() => { setW(29 * a); setH(29 * b); }}>{a}x{b} boards</button>)}
      </div>
      <Field label="Palette">
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          {palettes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => {
          const now = Date.now();
          onCreate({ id: newId(), name, paletteId: pid, pattern: emptyPattern(w, h), createdAt: now, updatedAt: now });
        }}>Create</button>
      </div>
    </Modal>
  );
}
