import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { contrastText, hexToRgb } from '../lib/color';
import type { Palette } from '../lib/palette';
import type { Pattern } from '../lib/pattern';
import { shortCode } from '../lib/pdf';

export interface ViewOptions {
  style: 'round' | 'square';
  grid: boolean;
  boardSize: number; // 0 = off
  codes: boolean;
  highlight: number | null; // palette index to emphasize
}

export interface CanvasHandle {
  fit: () => void;
  zoom: (factor: number) => void;
}

interface Props {
  pattern: Pattern;
  palette: Palette;
  view: ViewOptions;
  overlay?: { points: [number, number][]; color: number } | null;
  /** If true, single-pointer drags pan instead of drawing */
  panOnly?: boolean;
  onCellDown?: (x: number, y: number, button: number) => void;
  onCellMove?: (x: number, y: number) => void;
  onCellUp?: () => void;
  onHover?: (cell: [number, number] | null) => void;
  handleRef?: Ref<CanvasHandle>;
  fitKey?: string | number;
}

export function PatternCanvas(props: Props) {
  const { pattern, palette, view, overlay, panOnly } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({ scale: 10, ox: 0, oy: 0, w: 0, h: 0, fitted: false });
  const raf = useRef(0);
  const cb = useRef(props);
  cb.current = props;

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { pattern: P, palette: pal, view: v, overlay: ov } = cb.current;
    const s = st.current;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9e9ee';
    ctx.fillRect(0, 0, s.w, s.h);
    const cs = s.scale;
    const W = P.width, H = P.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(s.ox, s.oy, W * cs, H * cs);
    const x0 = Math.max(0, Math.floor(-s.ox / cs)), y0 = Math.max(0, Math.floor(-s.oy / cs));
    const x1 = Math.min(W, Math.ceil((s.w - s.ox) / cs)), y1 = Math.min(H, Math.ceil((s.h - s.oy) / cs));
    const hexes = pal.colors.map((c) => c.hex);
    const hl = v.highlight;
    const ovSet = ov && ov.points.length ? new Set(ov.points.map(([x, y]) => y * W + x)) : null;

    if (cs < 5) {
      // Fast path: draw 1 px per cell and scale up
      const img = new ImageData(W, H);
      const rgbs = pal.colors.map((c) => hexToRgb(c.hex));
      for (let i = 0; i < W * H; i++) {
        let c = P.cells[i];
        if (ovSet?.has(i)) c = ov!.color;
        if (c < 0) continue;
        const [r, g, b] = rgbs[c];
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = hl === null || hl === c ? 255 : 40;
      }
      const off = new OffscreenCanvas(W, H);
      off.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, s.ox, s.oy, W * cs, H * cs);
    } else {
      const round = v.style === 'round';
      const rad = cs * 0.46;
      const hole = cs >= 10 ? cs * 0.14 : 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          let c = P.cells[i];
          const isOv = ovSet?.has(i);
          if (isOv) c = ov!.color;
          const px = s.ox + x * cs, py = s.oy + y * cs;
          if (c < 0) {
            if (isOv) { ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 1; ctx.strokeRect(px + 2, py + 2, cs - 4, cs - 4); }
            else if (cs >= 6) { ctx.fillStyle = '#cfcfd6'; ctx.beginPath(); ctx.arc(px + cs / 2, py + cs / 2, Math.max(1, cs * 0.07), 0, 7); ctx.fill(); }
            continue;
          }
          ctx.globalAlpha = hl === null || hl === c || isOv ? 1 : 0.13;
          ctx.fillStyle = hexes[c];
          if (round) {
            ctx.beginPath();
            ctx.arc(px + cs / 2, py + cs / 2, rad, 0, Math.PI * 2);
            if (hole) { ctx.moveTo(px + cs / 2 + hole, py + cs / 2); ctx.arc(px + cs / 2, py + cs / 2, hole, 0, Math.PI * 2, true); }
            ctx.fill('evenodd');
          } else ctx.fillRect(px, py, cs + 0.5, cs + 0.5);
        }
      ctx.globalAlpha = 1;
      if (v.codes && cs >= 16) {
        ctx.font = `600 ${Math.floor(cs * 0.34)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const c = P.cells[y * W + x];
            if (c < 0 || (hl !== null && hl !== c)) continue;
            const px = s.ox + x * cs + cs / 2, py = s.oy + y * cs + cs / 2;
            ctx.fillStyle = contrastText(hexes[c]);
            ctx.fillText(shortCode(pal.colors[c].code), px, round ? py - cs * 0.22 : py);
          }
      }
    }
    // grid
    if (v.grid && cs >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) { const px = Math.round(s.ox + x * cs) + 0.5; ctx.moveTo(px, s.oy + y0 * cs); ctx.lineTo(px, s.oy + y1 * cs); }
      for (let y = y0; y <= y1; y++) { const py = Math.round(s.oy + y * cs) + 0.5; ctx.moveTo(s.ox + x0 * cs, py); ctx.lineTo(s.ox + x1 * cs, py); }
      ctx.stroke();
    }
    if (v.boardSize > 0) {
      ctx.strokeStyle = 'rgba(220,30,60,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += v.boardSize) { ctx.moveTo(s.ox + x * cs, s.oy); ctx.lineTo(s.ox + x * cs, s.oy + H * cs); }
      for (let y = 0; y <= H; y += v.boardSize) { ctx.moveTo(s.ox, s.oy + y * cs); ctx.lineTo(s.ox + W * cs, s.oy + y * cs); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(s.ox - 0.5, s.oy - 0.5, W * cs + 1, H * cs + 1);
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const s = st.current;
    const P = cb.current.pattern;
    if (!s.w || !s.h) return;
    const pad = 16;
    s.scale = Math.max(0.5, Math.min((s.w - pad * 2) / P.width, (s.h - pad * 2) / P.height, 60));
    s.ox = (s.w - P.width * s.scale) / 2;
    s.oy = (s.h - P.height * s.scale) / 2;
    s.fitted = true;
    schedule();
  }, [schedule]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const s = st.current;
    const ns = Math.max(0.5, Math.min(120, s.scale * factor));
    s.ox = cx - ((cx - s.ox) * ns) / s.scale;
    s.oy = cy - ((cy - s.oy) * ns) / s.scale;
    s.scale = ns;
    schedule();
  }, [schedule]);

  useImperativeHandle(props.handleRef, () => ({
    fit,
    zoom: (f: number) => zoomAt(f, st.current.w / 2, st.current.h / 2),
  }), [fit, zoomAt]);

  // Resize
  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const s = st.current;
      s.w = r.width; s.h = r.height;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = r.width + 'px';
      canvas.style.height = r.height + 'px';
      if (!s.fitted) fit(); else schedule();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

  useEffect(() => { schedule(); }, [pattern, palette, view, overlay, schedule]);
  useEffect(() => { fit(); }, [props.fitKey, pattern.width, pattern.height, fit]);

  // Pointer handling: 1 pointer draws (or pans), 2 pointers pinch-zoom + pan, middle/right... button pans.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'draw' | 'pan' | 'pinch' = 'none';
    let last = { x: 0, y: 0, d: 0 };
    let lastCell = '';
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const cellAt = (x: number, y: number): [number, number] | null => {
      const s = st.current;
      const cx = Math.floor((x - s.ox) / s.scale), cy = Math.floor((y - s.oy) / s.scale);
      const P = cb.current.pattern;
      return cx >= 0 && cy >= 0 && cx < P.width && cy < P.height ? [cx, cy] : null;
    };
    const centroid = () => {
      const pts = [...pointers.values()];
      const x = (pts[0].x + pts[1].x) / 2, y = (pts[0].y + pts[1].y) / 2;
      return { x, y, d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        if (mode === 'draw') cb.current.onCellUp?.();
        mode = 'pinch';
        last = centroid();
        return;
      }
      if (pointers.size > 2) return;
      const panBtn = e.button === 1 || (e.button === 0 && (cb.current.panOnly || e.altKey || !cb.current.onCellDown));
      if (panBtn) { mode = 'pan'; last = { ...p, d: 0 }; return; }
      const c = cellAt(p.x, p.y);
      if (!cb.current.onCellDown) return;
      mode = 'draw';
      lastCell = c ? c.join(',') : '';
      if (c) cb.current.onCellDown(c[0], c[1], e.button);
      else cb.current.onCellDown(-1, -1, e.button);
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (mode === 'pinch' && pointers.size >= 2) {
        const c = centroid();
        const s = st.current;
        s.ox += c.x - last.x; s.oy += c.y - last.y;
        if (last.d > 0) zoomAt(c.d / last.d, c.x, c.y);
        last = c;
        schedule();
        return;
      }
      if (mode === 'pan') {
        const s = st.current;
        s.ox += p.x - last.x; s.oy += p.y - last.y;
        last = { ...p, d: 0 };
        schedule();
        return;
      }
      const c = cellAt(p.x, p.y);
      cb.current.onHover?.(c);
      if (mode === 'draw' && c) {
        const key = c.join(',');
        if (key !== lastCell) { lastCell = key; cb.current.onCellMove?.(c[0], c[1]); }
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === 'draw') cb.current.onCellUp?.();
      if (pointers.size === 0) mode = 'none';
      else if (mode === 'pinch' && pointers.size === 1) { mode = 'pan'; last = { ...[...pointers.values()][0], d: 0 }; }
    };
    const leave = () => cb.current.onHover?.(null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.shiftKey || (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        // horizontal scroll / shift+wheel pans
        const s = st.current;
        s.ox -= (e.deltaX || e.deltaY) * unit;
        if (!e.shiftKey) s.oy -= e.deltaY * unit;
        schedule();
      } else {
        // wheel and trackpad pinch (ctrlKey) zoom around the cursor
        zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
      }
    };
    const ctxMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', ctxMenu);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', ctxMenu);
    };
  }, [schedule, zoomAt]);

  return (
    <div ref={wrapRef} className="pattern-canvas" style={{ cursor: panOnly ? 'grab' : 'crosshair' }}>
      <canvas ref={canvasRef} />
      <div className="zoom-controls">
        <button onClick={() => zoomAt(1.25, st.current.w / 2, st.current.h / 2)} title="Zoom in">+</button>
        <button onClick={() => zoomAt(0.8, st.current.w / 2, st.current.h / 2)} title="Zoom out">-</button>
        <button onClick={fit} title="Fit to view">Fit</button>
      </div>
    </div>
  );
}
