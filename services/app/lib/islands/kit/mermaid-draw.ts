import { deferEngine } from '../defer-engine';
import type { Drawn } from '@/lib/mermaid-images/reader-draw';

/** Optional engine leg of Mermaid: the ready-time kit keeps stored drawings without this chunk. */
export function startMermaidDraw(host: HTMLElement, code: string, dark: boolean, signal: AbortSignal, done: (drawn: Drawn) => void): void {
  if (signal.aborted) return;
  const cancel = deferEngine(host, () => {
    void import('@/lib/mermaid-images/reader-draw').then(m => m.drawForReader(host, code, dark, () => !signal.aborted)).then(
      drawn => { if (!signal.aborted && drawn) done({ code, ...drawn }); },
      () => { if (!signal.aborted) done({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); },
    );
  });
  signal.addEventListener('abort', cancel, { once: true });
}
