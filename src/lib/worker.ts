/// <reference lib="webworker" />
import { runGenerate, type GenerateSettings } from './generate';
import type { SourceImage } from './image';
import type { Palette } from './palette';

export type WorkerRequest =
  | { type: 'image'; image: SourceImage }
  | { type: 'generate'; id: number; palette: Palette; owned: string[] | undefined; settings: GenerateSettings };

let image: SourceImage | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'image') { image = msg.image; return; }
  if (!image) return;
  try {
    const r = runGenerate(image, msg.palette, msg.owned, msg.settings);
    (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result: r }, [r.cells.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
