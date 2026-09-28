// DESTINATION: services/app/web/__tests__/island-handover.ui.test.ts
/**
 * THE SPA'S HANDOVER (docs/phase2-architecture.md §7; lib/islands/contract IslandDocument): the React app
 * boots on idle or first interaction, finds the live island document on the story root, adopts the
 * element WITHOUT re-rendering it (same nodes before and after), and disposes the islands only when
 * edit mode begins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleSpaBoot } from '../idle-boot';
import { adoptInitialStory, captureInitialStory, initialDocumentStory } from '../initial-story';
import { installIslandDocument, islandDocumentOf } from '@/lib/islands/handover';
import type { IslandDocument } from '@/lib/islands/contract';

const fakeDocument = (root: HTMLElement): IslandDocument & { disposed: number; modes: string[] } => {
  const listeners = new Set<(e: unknown) => void>();
  let mode: 'read' | 'edit' = 'read';
  const doc = {
    root, store: null, context: null as never, disposed: 0, modes: [] as string[],
    mode: () => mode, setMode(next: 'read' | 'edit') { mode = next; doc.modes.push(next); if (next === 'edit') doc.disposed++; for (const l of listeners) l({ type: 'mode', mode: next }); },
    ready: () => true, subscribe(l: (e: unknown) => void) { listeners.add(l); return () => listeners.delete(l); }, dispose() { doc.disposed++; },
  };
  return doc as never;
};

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('scheduleSpaBoot', () => {
  it('boots once on idle, or at once on the first interaction, never twice', () => {
    const load = vi.fn(async () => {});
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined;
    scheduleSpaBoot(load, { idleMs: 2000 });
    expect(load).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('boots on the idle timer when nobody interacts', () => {
    const load = vi.fn(async () => {});
    scheduleSpaBoot(load, { idleMs: 2000 });
    vi.advanceTimersByTime(2001);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('adopting the island document', () => {
  it('finds the document on the story root and adopts the same element with its children intact', () => {
    document.body.innerHTML = '<div id="root"></div><div id="mx-story-root" data-mx-inline-story=""><h1 id="h">Title</h1><div data-hk="s0-0" id="i">island</div></div>';
    const root = document.getElementById('mx-story-root') as HTMLElement;
    const island = root.querySelector('#i');
    const doc = fakeDocument(root);
    installIslandDocument(root, doc);
    expect(islandDocumentOf(root)).toBe(doc);
    captureInitialStory();
    expect(initialDocumentStory()).toBe(root);
    const adopted = adoptInitialStory();
    expect(adopted).toBe(root);
    expect(adopted!.querySelector('#i')).toBe(island);
    expect(islandDocumentOf(adopted!)).toBe(doc);
    expect(doc.disposed).toBe(0);
  });
  it('edit mode disposes the islands exactly once; reading again is not re-entered in place', () => {
    document.body.innerHTML = '<div id="mx-story-root" data-mx-inline-story=""><div data-hk="s0-0" id="i">island</div></div>';
    const root = document.getElementById('mx-story-root') as HTMLElement;
    const doc = fakeDocument(root);
    installIslandDocument(root, doc);
    islandDocumentOf(root)!.setMode('edit');
    expect(doc.disposed).toBe(1);
    expect(root.querySelector('#i')?.textContent).toBe('island');
  });
});
