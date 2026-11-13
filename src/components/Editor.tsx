import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contrastText } from '../lib/color';
import type { Palette } from '../lib/palette';
import {
  colorCounts, ellipsePoints, serializeProject, flip, floodFill, linePoints, rectPoints, replaceColor, resizeCanvas, rotate, trim,
  type Anchor, type Pattern, type Project,
} from '../lib/pattern';
import { shortCode } from '../lib/pdf';
import { downloadBlob, safeFilename } from '../lib/storage';
import { ExportPdfDialog } from './ExportPdfDialog';
import { PatternCanvas, type CanvasHandle, type ViewOptions } from './PatternCanvas';
import { Check, Field, Modal, NumberInput } from './ui';

type Tool = 'pencil' | 'eraser' | 'fill' | 'replace' | 'picker' | 'line' | 'rect' | 'rectFill' | 'ellipse' | 'pan';

const TOOLS: { id: Tool; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'pencil', label: 'Pencil', icon: '✎', key: 'b', hint: 'Draw beads (B)' },
  { id: 'eraser', label: 'Eraser', icon: '⌫', key: 'e', hint: 'Remove beads (E)' },
  { id: 'fill', label: 'Fill', icon: '◧', key: 'g', hint: 'Fill connected area (G)' },
  { id: 'replace', label: 'Replace', icon: '⇄', key: 'x', hint: 'Replace every bead of the tapped color with the current color (X)' },
  { id: 'picker', label: 'Pick', icon: '◉', key: 'i', hint: 'Pick a color from the pattern (I)' },
  { id: 'line', label: 'Line', icon: '╱', key: 'l', hint: 'Straight line (L)' },
  { id: 'rect', label: 'Rect', icon: '▭', key: 'r', hint: 'Rectangle outline (R)' },
  { id: 'rectFill', label: 'Box', icon: '■', key: 'f', hint: 'Filled rectangle (F)' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯', key: 'o', hint: 'Ellipse outline (O)' },
  { id: 'pan', label: 'Pan', icon: '✋', key: 'h', hint: 'Move the view (H). Two fingers always pan and zoom.' },
];

interface Props {
  project: Project;
  palette: Palette;
  owned: string[] | undefined;
  onChange: (p: Project) => void;
}

const MAX_HISTORY = 200;

export function Editor({ project, palette, owned, onChange }: Props) {
  const [pattern, setPattern] = useState<Pattern>(project.pattern);
  const [name, setName] = useState(project.name);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState<number>(() => {
    const c = [...colorCounts(project.pattern).entries()].sort((a, b) => b[1] - a[1])[0];
    return c ? c[0] : 0;
  });
  const [symH, setSymH] = useState(false);
  const [symV, setSymV] = useState(false);
  const [view, setView] = useState<ViewOptions>({ style: 'round', grid: true, boardSize: 29, codes: false, highlight: null });
  const [overlay, setOverlay] = useState<{ points: [number, number][]; color: number } | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [filter, setFilter] = useState<'owned' | 'all'>(owned ? 'owned' : 'all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'pdf' | 'resize' | 'png' | null>(null);
  const [, force] = useState(0);
  const undo = useRef<Pattern[]>([]);
  const redo = useRef<Pattern[]>([]);
  const canvasRef = useRef<CanvasHandle>(null);
  const stroke = useRef<{ start: [number, number]; last: [number, number]; cells: Int16Array | null; tool: Tool } | null>(null);
  const patRef = useRef(pattern);
  patRef.current = pattern;

  // Persist (debounced)
  const projRef = useRef(project);
  projRef.current = project;
  useEffect(() => {
    if (pattern === projRef.current.pattern && name === projRef.current.name) return;
    const t = setTimeout(() => onChange({ ...projRef.current, name, pattern, updatedAt: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [pattern, name, onChange]);

  const commit = useCallback((next: Pattern) => {
    undo.current.push(patRef.current);
    if (undo.current.length > MAX_HISTORY) undo.current.shift();
    redo.current = [];
    setPattern(next);
  }, []);

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(patRef.current);
    setPattern(prev);
    force((n) => n + 1);
  }, []);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(patRef.current);
    setPattern(next);
    force((n) => n + 1);
  }, []);

  const symmetric = useCallback((pts: [number, number][]): [number, number][] => {
    const P = patRef.current;
    let out = pts;
    if (symH) out = out.concat(out.map(([x, y]) => [P.width - 1 - x, y] as [number, number]));
    if (symV) out = out.concat(out.map(([x, y]) => [x, P.height - 1 - y] as [number, number]));
    return out;
  }, [symH, symV]);

  const paint = (cells: Int16Array, pts: [number, number][], value: number) => {
    const P = patRef.current;
    for (const [x, y] of symmetric(pts)) if (x >= 0 && y >= 0 && x < P.width && y < P.height) cells[y * P.width + x] = value;
  };

  const shapePoints = (t: Tool, a: [number, number], b: [number, number]) =>
    t === 'line' ? linePoints(a[0], a[1], b[0], b[1])
      : t === 'ellipse' ? ellipsePoints(a[0], a[1], b[0], b[1], false)
        : rectPoints(a[0], a[1], b[0], b[1], t === 'rectFill');

  const onCellDown = (x: number, y: number, button: number) => {
    if (x < 0) return;
    const P = patRef.current;
    const t: Tool = button === 2 ? 'eraser' : tool;
    const value = t === 'eraser' ? -1 : color;
    if (t === 'picker') {
      const c = P.cells[y * P.width + x];
      if (c >= 0) { setColor(c); setTool('pencil'); }
      return;
    }
    if (t === 'fill') { commit({ ...P, cells: floodFill(P, x, y, color) }); return; }
    if (t === 'replace') {
      const from = P.cells[y * P.width + x];
      if (from !== color) commit({ ...P, cells: replaceColor(P, from, color) });
      return;
    }
    if (t === 'pencil' || t === 'eraser') {
      const cells = P.cells.slice();
      paint(cells, [[x, y]], value);
      undo.current.push(P);
      if (undo.current.length > MAX_HISTORY) undo.current.shift();
      redo.current = [];
      stroke.current = { start: [x, y], last: [x, y], cells, tool: t };
      setPattern({ ...P, cells: cells.slice() });
      return;
    }
    stroke.current = { start: [x, y], last: [x, y], cells: null, tool: t };
    setOverlay({ points: symmetric([[x, y]]), color: value });
  };

  const onCellMove = (x: number, y: number) => {
    const s = stroke.current;
    if (!s) return;
    if (s.cells) {
      const value = s.tool === 'eraser' ? -1 : color;
      paint(s.cells, linePoints(s.last[0], s.last[1], x, y), value);
      s.last = [x, y];
      setPattern({ ...patRef.current, cells: s.cells.slice() });
    } else {
      s.last = [x, y];
      setOverlay({ points: symmetric(shapePoints(s.tool, s.start, s.last)), color });
    }
  };

  const onCellUp = () => {
    const s = stroke.current;
    stroke.current = null;
    if (!s) return;
    if (!s.cells) {
      const P = patRef.current;
      const cells = P.cells.slice();
      paint(cells, shapePoints(s.tool, s.start, s.last), color);
      setOverlay(null);
      commit({ ...P, cells });
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((t) => t.key === e.key.toLowerCase());
      if (t) setTool(t.id);
      if (e.key === '0') canvasRef.current?.fit();
      if (e.key === '+' || e.key === '=') canvasRef.current?.zoom(1.25);
      if (e.key === '-') canvasRef.current?.zoom(0.8);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [doUndo, doRedo]);

  const counts = useMemo(() => [...colorCounts(pattern).entries()].sort((a, b) => b[1] - a[1]), [pattern]);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const ownedSet = useMemo(() => (owned ? new Set(owned) : null), [owned]);
  const paletteList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return palette.colors
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (filter === 'all' || !ownedSet || ownedSet.has(c.code)) &&
        (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
  }, [palette, filter, ownedSet, search]);

  const hoverInfo = hover ? (() => {
    const c = pattern.cells[hover[1] * pattern.width + hover[0]];
    return `x ${hover[0] + 1}, y ${hover[1] + 1}` + (c >= 0 ? `: ${palette.colors[c].code} ${palette.colors[c].name}` : ': empty');
  })() : '';

  const exportJson = () => {
    const data = serializeProject({ ...project, name, pattern }, palette);
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), safeFilename(name) + '.perler.json');
  };

  const cur = palette.colors[color];

  return (
    <div className="editor">
      <div className="toolbar">
        <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Pattern name" />
        <div className="tool-group">
          {TOOLS.map((t) => (
            <button key={t.id} className={'tool' + (tool === t.id ? ' active' : '')} onClick={() => setTool(t.id)} title={t.hint}>
              <span className="tool-icon">{t.icon}</span><span className="tool-label">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button className={'tool' + (symH ? ' active' : '')} onClick={() => setSymH(!symH)} title="Mirror drawing left/right"><span className="tool-icon">⇹</span><span className="tool-label">Mirror</span></button>
          <button className={'tool' + (symV ? ' active' : '')} onClick={() => setSymV(!symV)} title="Mirror drawing top/bottom"><span className="tool-icon">⇕</span><span className="tool-label">Mirror</span></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)"><span className="tool-icon">↶</span><span className="tool-label">Undo</span></button>
          <button className="tool" onClick={doRedo} disabled={!redo.current.length} title="Redo (Ctrl+Shift+Z)"><span className="tool-icon">↷</span><span className="tool-label">Redo</span></button>
        </div>
        <div className="tool-group">
          <button onClick={() => setDialog('pdf')} className="primary">Export PDF</button>
          <details className="menu">
            <summary>More</summary>
            <div className="menu-items" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).open = false}>
              <button onClick={() => setDialog('resize')}>Resize canvas...</button>
              <button onClick={() => commit(trim(pattern))}>Trim empty edges</button>
              <button onClick={() => commit(flip(pattern, true))}>Flip horizontal</button>
              <button onClick={() => commit(flip(pattern, false))}>Flip vertical</button>
              <button onClick={() => commit(rotate(pattern, true))}>Rotate 90° right</button>
              <button onClick={() => commit(rotate(pattern, false))}>Rotate 90° left</button>
              <button onClick={() => { if (confirm('Clear all beads?')) commit({ ...pattern, cells: new Int16Array(pattern.cells.length).fill(-1) }); }}>Clear all</button>
              <hr />
              <button onClick={() => setDialog('png')}>Export PNG image...</button>
              <button onClick={exportJson}>Export pattern file (.json)</button>
            </div>
          </details>
        </div>
      </div>

      <div className="editor-body">
        <div className="canvas-area">
          <PatternCanvas
            pattern={pattern} palette={palette} view={view} overlay={overlay} panOnly={tool === 'pan'}
            onCellDown={onCellDown} onCellMove={onCellMove} onCellUp={onCellUp} onHover={setHover}
            handleRef={canvasRef} fitKey={project.id}
          />
          <div className="statusbar">
            <span>{pattern.width} x {pattern.height}</span>
            <span>{total} beads, {counts.length} colors</span>
            <span className="hover-info">{hoverInfo}</span>
          </div>
        </div>

        <aside className="panel side">
          <div className="current-color">
            <span className="swatch big" style={{ background: cur?.hex }} />
            <div>
              <div><b>{cur?.code}</b> {cur?.name}</div>
              <div className="muted small">{cur?.hex}{cur?.effect ? ', effect color' : ''}{ownedSet && cur && !ownedSet.has(cur.code) ? ', not owned' : ''}</div>
            </div>
          </div>

          <details className="section" open>
            <summary>View</summary>
            <div className="section-body view-opts">
              <Check checked={view.style === 'round'} onChange={(v) => setView({ ...view, style: v ? 'round' : 'square' })} label="Round beads" />
              <Check checked={view.grid} onChange={(grid) => setView({ ...view, grid })} label="Grid" />
              <Check checked={view.codes} onChange={(codes) => setView({ ...view, codes })} label="Color codes (zoom in)" />
              <Check checked={view.boardSize > 0} onChange={(v) => setView({ ...view, boardSize: v ? 29 : 0 })} label="Board outlines (29)" />
            </div>
          </details>

          <details className="section" open>
            <summary>In this pattern ({counts.length})</summary>
            <div className="section-body color-list">
              {counts.map(([ci, n]) => {
                const c = palette.colors[ci];
                const notOwned = ownedSet && !ownedSet.has(c.code);
                return (
                  <div key={ci} className={'color-row' + (ci === color ? ' selected' : '')}>
                    <button className="color-main" onClick={() => setColor(ci)} title={`${c.code} ${c.name}`}>
                      <span className="swatch" style={{ background: c.hex }} />
                      <span className="code">{c.code}</span>
                      <span className="cname">{c.name}{notOwned && <span className="warn" title="Not in your owned colors"> !</span>}</span>
                      <span className="count">{n}</span>
                    </button>
                    <button className={'icon' + (view.highlight === ci ? ' active' : '')} title="Highlight only this color"
                      onClick={() => setView({ ...view, highlight: view.highlight === ci ? null : ci })}>◎</button>
                  </div>
                );
              })}
              {view.highlight !== null && <button className="block" onClick={() => setView({ ...view, highlight: null })}>Show all colors</button>}
            </div>
          </details>

          <details className="section" open>
            <summary>Palette: {palette.name}</summary>
            <div className="section-body">
              <div className="row">
                <input placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
                {ownedSet && (
                  <select value={filter} onChange={(e) => setFilter(e.target.value as 'owned' | 'all')}>
                    <option value="owned">Owned</option>
                    <option value="all">All</option>
                  </select>
                )}
              </div>
              <div className="swatch-grid">
                {paletteList.map(({ c, i }) => (
                  <button key={c.code} className={'swatch-btn' + (i === color ? ' selected' : '')} style={{ background: c.hex }}
                    onClick={() => { setColor(i); if (tool === 'eraser' || tool === 'picker' || tool === 'pan') setTool('pencil'); }}
                    title={`${c.code} ${c.name}${c.effect ? ' (effect)' : ''}`}>
                    <span style={{ color: contrastText(c.hex) }}>{shortCode(c.code)}</span>
                  </button>
                ))}
              </div>
            </div>
          </details>
        </aside>
      </div>

      {dialog === 'pdf' && <ExportPdfDialog pattern={pattern} palette={palette} name={name} onClose={() => setDialog(null)} />}
      {dialog === 'resize' && <ResizeDialog pattern={pattern} onClose={() => setDialog(null)} onApply={(p) => { commit(p); setDialog(null); }} />}
      {dialog === 'png' && <PngDialog pattern={pattern} palette={palette} name={name} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ResizeDialog({ pattern, onClose, onApply }: { pattern: Pattern; onClose: () => void; onApply: (p: Pattern) => void }) {
  const [w, setW] = useState(pattern.width);
  const [h, setH] = useState(pattern.height);
  const [anchor, setAnchor] = useState<Anchor>('c');
  const anchors: Anchor[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
  return (
    <Modal title="Resize canvas" onClose={onClose}>
      <p className="muted small">Adds or removes empty pegs around the pattern. Beads are not scaled.</p>
      <div className="row">
        <Field label="Width"><NumberInput value={w} min={1} max={500} onChange={setW} /></Field>
        <Field label="Height"><NumberInput value={h} min={1} max={500} onChange={setH} /></Field>
      </div>
      <div className="chips">
        {[1, 2, 3, 4].map((n) => <button key={n} className="chip" onClick={() => { setW(29 * n); setH(29 * n); }}>{n}x{n} boards</button>)}
      </div>
      <Field label="Anchor">
        <div className="anchor-grid">
          {anchors.map((a) => <button key={a} className={anchor === a ? 'active' : ''} onClick={() => setAnchor(a)}>{anchor === a ? '●' : '○'}</button>)}
        </div>
      </Field>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onApply(resizeCanvas(pattern, w, h, anchor))}>Apply</button>
      </div>
    </Modal>
  );
}

function PngDialog({ pattern, palette, name, onClose }: { pattern: Pattern; palette: Palette; name: string; onClose: () => void }) {
  const [px, setPx] = useState(16);
  const [round, setRound] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const save = () => {
    const c = document.createElement('canvas');
    c.width = pattern.width * px;
    c.height = pattern.height * px;
    const ctx = c.getContext('2d')!;
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    for (let y = 0; y < pattern.height; y++)
      for (let x = 0; x < pattern.width; x++) {
        const v = pattern.cells[y * pattern.width + x];
        if (v < 0) continue;
        ctx.fillStyle = palette.colors[v].hex;
        if (round && px >= 4) {
          ctx.beginPath();
          ctx.arc((x + 0.5) * px, (y + 0.5) * px, px * 0.46, 0, Math.PI * 2);
          ctx.moveTo((x + 0.5) * px + px * 0.14, (y + 0.5) * px);
          ctx.arc((x + 0.5) * px, (y + 0.5) * px, px * 0.14, 0, Math.PI * 2, true);
          ctx.fill('evenodd');
        } else ctx.fillRect(x * px, y * px, px, px);
      }
    c.toBlob((b) => { if (b) downloadBlob(b, safeFilename(name) + '.png'); onClose(); }, 'image/png');
  };
  return (
    <Modal title="Export PNG" onClose={onClose}>
      <Field label="Pixels per bead" hint="1 = plain pixel art at native size"><NumberInput value={px} min={1} max={64} onChange={setPx} /></Field>
      <Check checked={round} onChange={setRound} label="Draw round beads" />
      <Check checked={transparent} onChange={setTransparent} label="Transparent background" />
      <p className="muted small">{pattern.width * px} x {pattern.height * px} px</p>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>Save PNG</button>
      </div>
    </Modal>
  );
}
