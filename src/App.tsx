import { useCallback, useEffect, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { Generator } from './components/Generator';
import { PaletteManager } from './components/PaletteManager';
import { Projects } from './components/Projects';
import { DEFAULT_SETTINGS, type GenerateSettings } from './lib/generate';
import { BUILTIN_PALETTES, DEFAULT_PALETTE_ID, type Palette } from './lib/palette';
import { deserializeProject, serializeProject, type Project, type SerializedProject } from './lib/pattern';
import { storage } from './lib/storage';

type Tab = 'generate' | 'edit' | 'projects' | 'palettes';
const LAST_KEY = 'perler-studio.last.v1';

export default function App() {
  const [tab, setTab] = useState<Tab>('generate');
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(() => storage.loadCustomPalettes());
  const palettes = useMemo(() => [...BUILTIN_PALETTES, ...customPalettes], [customPalettes]);
  const [owned, setOwned] = useState<Record<string, string[]>>(() => storage.loadOwned());
  const [projects, setProjects] = useState<SerializedProject[]>(() => storage.loadProjects());
  const [settings, setSettings] = useState<GenerateSettings>(() => {
    const s = storage.loadSettings(DEFAULT_SETTINGS);
    return { ...s, size: { ...DEFAULT_SETTINGS.size, ...s.size }, adjustments: { ...DEFAULT_SETTINGS.adjustments, ...s.adjustments } };
  });
  const [current, setCurrent] = useState<Project | null>(() => {
    const id = localStorage.getItem(LAST_KEY);
    const s = id && storage.loadProjects().find((p) => p.id === id);
    if (!s) return null;
    try { return deserializeProject(s, [...BUILTIN_PALETTES, ...storage.loadCustomPalettes()]).project; } catch { return null; }
  });

  useEffect(() => { storage.saveSettings(settings); }, [settings]);
  useEffect(() => { if (current) localStorage.setItem(LAST_KEY, current.id); }, [current?.id]);

  const paletteOf = useCallback((id: string) => palettes.find((p) => p.id === id) ?? palettes[0], [palettes]);

  const upsert = useCallback((p: Project) => {
    const s = serializeProject(p, paletteOf(p.paletteId));
    setProjects((list) => {
      const next = list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
      storage.saveProjects(next);
      return next;
    });
  }, [paletteOf]);

  const openProject = (p: Project) => { setCurrent(p); setTab('edit'); };

  const onEditorChange = useCallback((p: Project) => { setCurrent(p); upsert(p); }, [upsert]);

  const setOwnedFor = (pid: string, codes: string[] | undefined) => {
    setOwned((o) => {
      const n = { ...o };
      if (codes) n[pid] = codes; else delete n[pid];
      storage.saveOwned(n);
      return n;
    });
  };

  // Warn before leaving with unsaved data is unnecessary: everything autosaves to local storage.

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>●</span> Perler Studio</div>
        <nav className="tabs">
          {([
            ['generate', 'Generate'],
            ['edit', 'Editor'],
            ['projects', 'Patterns'],
            ['palettes', 'My colors'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} className={'tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)} disabled={id === 'edit' && !current}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {/* Generator stays mounted so the loaded image and preview survive tab switches */}
        <div className="tab-pane" hidden={tab !== 'generate'}>
          <Generator
            palettes={palettes} owned={owned} settings={settings} onSettings={setSettings}
            onCreate={(p) => { upsert(p); openProject(p); }}
            onManagePalettes={() => setTab('palettes')}
          />
        </div>
        {tab === 'edit' && current && (
          <Editor key={current.id} project={current} palette={paletteOf(current.paletteId)} owned={owned[current.paletteId]} onChange={onEditorChange} />
        )}
        {tab === 'projects' && (
          <Projects
            projects={projects} palettes={palettes} currentId={current?.id ?? null} defaultPaletteId={settings.paletteId}
            onOpen={openProject}
            onImport={upsert}
            onDelete={(id) => {
              setProjects((list) => { const n = list.filter((x) => x.id !== id); storage.saveProjects(n); return n; });
              if (current?.id === id) setCurrent(null);
            }}
          />
        )}
        {tab === 'palettes' && (
          <PaletteManager
            palettes={palettes} owned={owned} onOwned={setOwnedFor} initialId={settings.paletteId || DEFAULT_PALETTE_ID}
            onAddPalette={(p) => setCustomPalettes((l) => { const n = [...l, p]; storage.saveCustomPalettes(n); return n; })}
            onDeletePalette={(id) => setCustomPalettes((l) => { const n = l.filter((p) => p.id !== id); storage.saveCustomPalettes(n); return n; })}
          />
        )}
      </main>
    </div>
  );
}
