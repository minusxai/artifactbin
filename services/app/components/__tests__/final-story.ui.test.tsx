/**
 * A STORY SERVED FINAL runs no story runtime (components/FinalStory).
 *
 * A static document read by someone who may neither edit nor comment is kept
 * exactly as the server drew it: taken into the app's tree where the runtime
 * would have put it, its outline and table marks wired, and the runtime's code
 * never imported. The moment the viewer needs a runtime (here: their role now
 * lets them comment), the runtime is loaded first and then takes the SAME
 * element over — with the marks the page made taken back, so it hydrates the
 * server's markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import type { InlineStoryController, InlineStoryRuntimeProps } from '@/lib/story-runtime/InlineStoryRuntime';
import { captureInitialStory, clearInitialStory, initialDocumentStory } from '@/web/initial-story';
import { STORY_READER_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface from '../ArtifactSurface';
import { requestPageChrome } from '../PageChrome';

/** What the runtime module saw: whether it was imported at all, and the story each mount found to hydrate. */
const runtime = vi.hoisted(() => ({ imported: false, mounts: [] as Array<{ story: HTMLElement | null; marked: number; hydrate: boolean }>, controllers: [] as InlineStoryController[] }));
vi.mock('@/lib/story-runtime/InlineStoryRuntime', () => {
  runtime.imported = true;
  return {
    InlineStoryRuntime: ({ onController, hydrateInitialStory }: InlineStoryRuntimeProps) => {
      useLayoutEffect(() => {
        const story = initialDocumentStory();
        runtime.mounts.push({ story, marked: story?.querySelectorAll('[aria-current],[data-mx-scrollable]').length ?? 0, hydrate: !!hydrateInitialStory });
        const controller = {
          nonce: 'r'.repeat(32), send: vi.fn(), update: vi.fn(), invalidate: vi.fn(),
          subscribe: () => () => {}, getViewportRect: () => new DOMRect(), dispose: () => {},
        } as unknown as InlineStoryController;
        runtime.controllers.push(controller);
        onController(controller);
        return () => onController(null);
      }, [onController]);
      return null;
    },
  };
});
vi.mock('@/components/AnnotationLayer', () => ({ default: () => null }));

/** A served, sectioned story on the page as server/app places it, final for this viewer. */
function serveFinalStory() {
  document.body.innerHTML = '<div id="root"></div>'
    + '<div data-mx-initial-story="" data-mx-final=""><style>body > #root:first-child{display:none!important}</style>'
    + '<div data-mx-inline-story="" data-mx-story-root="" class="light"><div class="mx-reading">'
    + '<nav class="mx-outline" aria-label="Contents"><button type="button" class="mx-outline-row" data-mx-target="0">One</button><button type="button" class="mx-outline-row" data-mx-target="1">Two</button></nav>'
    + '<div class="mx-doc"><h2 data-mx-ast="0">One</h2><p>words</p><h2 data-mx-ast="1">Two</h2><table><tbody><tr><td>1</td></tr></tbody></table></div>'
    + '</div></div></div>';
  captureInitialStory();
  return document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
}

beforeEach(() => {
  setupSurface();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  runtime.imported = false;
  runtime.mounts = [];
  runtime.controllers = [];
});
afterEach(() => { clearInitialStory(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('a static story, for a reader who may neither edit nor comment', () => {
  it('is kept as served, in the app, with its outline wired — and the story runtime is never imported', async () => {
    const story = serveFinalStory();
    const surface = <ArtifactShell role="viewer"><ArtifactSurface {...surfaceProps({ source: null })} /></ArtifactShell>;
    const view = render(surface);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(document.querySelector('[data-mx-initial-story]')).toBeNull();
    // In the app's tree (the test renders it into its own container), where the runtime would have put it.
    expect(view.container.querySelector('[data-mx-story-host]')?.contains(story)).toBe(true);
    expect(runtime.imported).toBe(false);
    expect(runtime.mounts).toEqual([]);
    // Nothing is loading: the served story IS the page.
    expect(screen.queryByLabelText('Loading document')).toBeNull();
    // The outline works without a runtime: one row is the section being read.
    expect(story.querySelectorAll('.mx-outline-row[aria-current="true"]').length).toBe(1);
    view.unmount();
  });

  it('hands the SAME element to the runtime, marks taken back, once the viewer may comment — and passes on their light/dark choice', async () => {
    const story = serveFinalStory();
    const view = render(<ArtifactShell role="viewer"><ArtifactSurface {...surfaceProps({ source: null })} /></ArtifactShell>);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(runtime.mounts).toEqual([]);
    // The reader picks dark while the story is kept: it lands on the served element at once.
    await act(async () => { requestPageChrome('controls'); });
    await act(async () => { screen.getByRole('button', { name: 'Dark mode' }).click(); });
    expect(story.className).toBe('dark');

    view.rerender(<ArtifactShell role="commenter"><ArtifactSurface {...surfaceProps({ source: null })} /></ArtifactShell>);
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {});
    expect(runtime.imported).toBe(true);
    expect(runtime.mounts).toHaveLength(1);
    expect(runtime.mounts[0]).toEqual({ story, marked: 0, hydrate: true });
    expect(runtime.controllers[0]!.send).toHaveBeenCalledWith({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' });
    view.unmount();
  });
});

describe('a reader who may edit', () => {
  it('gets the runtime at once, whatever the server said', async () => {
    serveFinalStory();
    const view = render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps({ source: null })} /></ArtifactShell>);
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {});
    expect(runtime.mounts).toHaveLength(1);
    expect(runtime.mounts[0]!.hydrate).toBe(true);
    view.unmount();
  });
});
