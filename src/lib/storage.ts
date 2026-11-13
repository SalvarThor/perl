import type { Palette } from './palette';
import type { SerializedProject } from './pattern';

const K = {
  projects: 'perler-studio.projects.v1',
  customPalettes: 'perler-studio.customPalettes.v1',
  owned: 'perler-studio.owned.v1',
  settings: 'perler-studio.settings.v1',
  pdf: 'perler-studio.pdf.v1',
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    alert('Could not save to browser storage (it may be full). Export your projects as files to keep them.\n\n' + e);
  }
}

export const storage = {
  loadProjects: () => read<SerializedProject[]>(K.projects, []),
  saveProjects: (p: SerializedProject[]) => write(K.projects, p),
  loadCustomPalettes: () => read<Palette[]>(K.customPalettes, []),
  saveCustomPalettes: (p: Palette[]) => write(K.customPalettes, p),
  /** paletteId -> owned color codes. A missing entry means "not configured" (treated as owning all). */
  loadOwned: () => read<Record<string, string[]>>(K.owned, {}),
  saveOwned: (o: Record<string, string[]>) => write(K.owned, o),
  loadSettings: <T,>(fallback: T) => ({ ...fallback, ...read<Partial<T>>(K.settings, {}) }),
  saveSettings: (s: unknown) => write(K.settings, s),
  loadPdf: <T,>(fallback: T) => ({ ...fallback, ...read<Partial<T>>(K.pdf, {}) }),
  savePdf: (s: unknown) => write(K.pdf, s),
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function safeFilename(name: string): string {
  return (name || 'pattern').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pattern';
}
