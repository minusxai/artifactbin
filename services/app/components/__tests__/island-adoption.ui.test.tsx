/**
 * THE SURFACE ADOPTS THE COMPILED PAGE (docs/phase2-architecture.md §7; components/IslandStory):
 * the served story root with its islands running is MOVED into the artifact viewport — the same
 * element, the same island nodes, the islands not disposed and still in `read` — with the app's
 * chrome around it and no interpreter mounted over it. Edit mode puts the islands in `edit`,
 * disposes them and mounts the interpreter afresh (never hydrating compiled HTML); leaving the
 * page disposes them without edit mode; a chrome control pressed before the app arrived is
 * performed once it has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import { installIslandDocument } from '@/lib/islands/handover';
import type { IslandDocument } from '@/lib/islands/contract';
import type { InlineStoryController, InlineStoryRuntimeProps } from '@/lib/story-runtime/InlineStoryRuntime';
import { STORY_DATA_MESSAGE } from '@/lib/story-runtime/contract';
import { captureInitialStory, clearInitialStory } from '@/web/initial-story';
import { scheduleSpaBoot } from '@/web/idle-boot';

const interpreters: InlineStoryRuntimeProps[] = [];
vi.mock('@/lib/story-runtime/InlineStoryRuntime', () => ({
  InlineStoryRuntime: (props: InlineStoryRuntimeProps) => {
    useLayoutEffect(() => {
      interpreters.push(props);
      const controller: InlineStoryController = {
        nonce: 'interpreter', send: () => {}, update: () => {}, invalidate: () => {},
        subscribe: () => () => {}, getViewportRect: () => new DOMRect(), dispose: () => {},
      };
      props.onController(controller);
      return () => props.onController(null);
    }, []);
    return <div data-mx-inline-story="" data-interpreter=""><p>interpreted</p></div>;
  },
}));
const layerProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/AnnotationLayer', () => ({
  default: (props: Record<string, unknown>) => { layerProps.push(props); return null; },
}));
vi.mock('@/components/ArtifactEditor', () => ({ default: () => <header aria-label="Editor toolbar" /> }));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface from '../ArtifactSurface';

type FakeIslands = IslandDocument & { events: string[]; invalidated: string[][] };

/** A served compiled page: `#root` hidden, the story root with one island, the served chrome beside it. */
function servePage(): { story: HTMLElement; island: Element; islands: FakeIslands } {
  document.body.innerHTML = '<div id="root" hidden></div>'
    + '<div id="mx-story-root" data-mx-inline-story="" data-mx-story-root="" class="light"><h1 data-mx-ast="0">Title</h1><div data-hk="s0-0" id="island" data-mx-ast="1">island</div></div>'
    + '<div class="mx-reader-chrome" data-mx-reader-chrome=""><div data-mx-reader-rail=""><button type="button" data-mx-reader-action="comment" aria-label="Comment">c</button></div></div>';
  const story = document.getElementById('mx-story-root')!;
  const events: string[] = [];
  const invalidated: string[][] = [];
  let mode: 'read' | 'edit' = 'read';
  const islands = {
    root: story, context: null as never, events, invalidated,
    store: { invalidateDatasets: (datasets: string[]) => { invalidated.push(datasets); } } as never,
    mode: () => mode,
    setMode(next: 'read' | 'edit') { if (next === 'edit') { mode = next; events.push('edit'); } },
    ready: () => true, subscribe: () => () => {},
    dispose() { events.push('dispose'); },
  } as FakeIslands;
  installIslandDocument(story, islands);
  captureInitialStory();
  return { story, island: story.querySelector('#island')!, islands };
}

const compiledProps = () => surfaceProps({
  source: null,
  runtime: { data: { nodes: [{ type: 'element', tag: 'h1', props: {}, children: ['Title'] }], refData: {}, colorMode: 'light', chrome: true }, css: '' } as never,
});

beforeEach(() => {
  setupSurface();
  interpreters.length = 0;
  layerProps.length = 0;
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  clearInitialStory();
  window.location.hash = '';
  vi.unstubAllGlobals();
});

describe('adopting the compiled page', () => {
  it('moves the same story element into the viewport, without an interpreter and without disposing the islands', async () => {
    const { story, island, islands } = servePage();
    render(<ArtifactSurface {...compiledProps()} />);
    const viewport = screen.getByLabelText('Artifact viewport');
    expect(viewport.contains(story)).toBe(true);
    expect(story.querySelector('#island')).toBe(island);
    expect(island.textContent).toBe('island');
    expect(interpreters).toHaveLength(0);
    // The app's chrome replaces the served one; the app's root is revealed; nothing says "loading".
    expect(document.querySelectorAll('[data-mx-reader-chrome]')).toHaveLength(1);
    expect(viewport.closest('body')!.querySelector(':scope > [data-mx-reader-chrome]')).toBeNull();
    expect(document.getElementById('root')!.hidden).toBe(false);
    expect(screen.queryByLabelText('Loading document')).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(islands.events).toEqual([]);
    expect(islands.mode()).toBe('read');
  });

  it('entering edit mode puts the islands in edit, disposes them and mounts the interpreter afresh', async () => {
    const { story, islands } = servePage();
    render(<ArtifactShell role="owner"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    expect(screen.getByLabelText('Artifact viewport').contains(story)).toBe(true);
    const edit = document.querySelector<HTMLElement>('[data-mx-reader-rail] [data-mx-reader-action="edit"]')!;
    await act(async () => { fireEvent.click(edit); await Promise.resolve(); });
    await waitFor(() => expect(interpreters).toHaveLength(1));
    expect(interpreters[0]!.hydrateInitialStory).toBe(false);
    expect(islands.events).toEqual(['edit', 'dispose']);
    expect(story.isConnected).toBe(false);
    expect(screen.getByLabelText('Artifact viewport').querySelector('[data-interpreter]')).not.toBeNull();
  });

  it('leaving the page disposes the islands without entering edit mode', async () => {
    const { story, islands } = servePage();
    const view = render(<ArtifactSurface {...compiledProps()} />);
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(islands.events).toEqual(['dispose']);
    expect(story.isConnected).toBe(false);
  });

  it('a newer version hands the document to the interpreter', async () => {
    const { islands } = servePage();
    const view = render(<ArtifactSurface {...compiledProps()} />);
    view.rerender(<ArtifactSurface {...compiledProps()} version={2} />);
    await act(async () => { await Promise.resolve(); });
    expect(interpreters).toHaveLength(1);
    expect(islands.events).toEqual(['dispose']);
  });

  it('a dataset wakeup re-runs the islands\' queries on their store', () => {
    const { islands } = servePage();
    const controllers: Array<InlineStoryController | null> = [];
    // The page's controller is what AnnotationLayer is handed: a commenter's page mounts it.
    render(<ArtifactShell role="commenter"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    const runtimeRef = layerProps.at(-1)!.runtimeRef as { current: InlineStoryController | null };
    controllers.push(runtimeRef.current);
    runtimeRef.current!.send({ type: STORY_DATA_MESSAGE, datasets: ['sales'] });
    expect(islands.invalidated).toEqual([['sales']]);
    expect(controllers[0]!.nonce).not.toBe('interpreter');
  });

  it('a surface that cannot adopt it (no prepared runtime) never hydrates the compiled story with React', async () => {
    servePage();
    render(<ArtifactSurface {...surfaceProps()} />);
    await waitFor(() => expect(interpreters).toHaveLength(1));
    expect(interpreters[0]!.hydrateInitialStory).toBe(false);
  });

  it('performs a served chrome control pressed before the app arrived, once', async () => {
    servePage();
    const load = vi.fn(async () => {});
    const boot = scheduleSpaBoot(load, { idleMs: 1000, capability: 'reader' });
    fireEvent.click(document.querySelector('body > [data-mx-reader-chrome] [data-mx-reader-action="comment"]')!);
    expect(load).toHaveBeenCalledTimes(1);
    render(<ArtifactShell role="commenter"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    await waitFor(() => expect(layerProps.at(-1)!.railOpen).toBe(true));
    boot.cancel();
  });
});
