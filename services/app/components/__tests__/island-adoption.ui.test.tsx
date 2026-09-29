/**
 * THE SURFACE ADOPTS THE COMPILED PAGE (docs/phase2-architecture.md §7; components/IslandStory):
 * the served story root with its islands running is MOVED into the artifact viewport — the same
 * element, the same island nodes, the islands not disposed and still in `read` — with the app's
 * chrome around it and no interpreter mounted over it. Edit mode puts the islands in `edit`,
 * keeps the compiled DOM and mounts editor controls by AST path; leaving the
 * page disposes them without edit mode; a newer version is drawn in place over the islands by the
 * one update path (lib/islands/live-update), never by the interpreter; a chrome control pressed
 * before the app arrived is performed once it has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import { installIslandDocument } from '@/lib/islands/handover';
import type { IslandDocument } from '@/lib/islands/contract';
import type { StoryController, EditorStoryRuntimeProps } from '@/lib/story-runtime/EditorStoryRuntime';
import { STORY_ANNOTATIONS_MESSAGE, STORY_DATA_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_READER_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import { updateCompiledStory } from '@/lib/islands/live-update';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const liveFrame = vi.hoisted(() => ({ current: null as null | { nodes: unknown[] } }));
vi.mock('@/lib/story/use-live-artifact', () => ({ useLiveArtifact: () => liveFrame.current }));

vi.mock('@/lib/islands/live-update', () => ({ updateCompiledStory: vi.fn(async () => 'morphed') }));
import { captureInitialStory, clearInitialStory } from '@/web/initial-story';
import { scheduleSpaBoot } from '@/web/idle-boot';

const interpreters: EditorStoryRuntimeProps[] = [];
const mountedDrafts: unknown[][] = [];
const editorRuntimeRefs: Array<{ current: StoryController | null }> = [];
vi.mock('@/solid/editor/dom-mounter', () => ({
  mountCompiledEditRegions: (_root: HTMLElement, nodes: unknown[]) => {
    mountedDrafts.push(nodes);
    return { dispose: () => {} };
  },
}));
vi.mock('@/lib/story-runtime/EditorStoryRuntime', () => ({
  EditorStoryRuntime: (props: EditorStoryRuntimeProps) => {
    useLayoutEffect(() => {
      interpreters.push(props);
      const controller: StoryController = {
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
vi.mock('@/components/ArtifactEditor', () => ({ default: ({ runtimeRef }: { runtimeRef: { current: StoryController | null } }) => {
  editorRuntimeRefs.push(runtimeRef);
  return <header aria-label="Editor toolbar" />;
} }));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface from '../ArtifactSurface';
import { IslandStory } from '../IslandStory';

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
  liveFrame.current = null;
  interpreters.length = 0;
  mountedDrafts.length = 0;
  editorRuntimeRefs.length = 0;
  layerProps.length = 0;
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  vi.mocked(updateCompiledStory).mockClear();
  clearInitialStory();
  window.location.hash = '';
  vi.unstubAllGlobals();
});

describe('adopting the compiled page', () => {
  it('keeps annotation pins painted while the compiled document is editable', async () => {
    const { story, islands } = servePage();
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={parseJsxOrThrow('<h1>Title</h1>').nodes}
      editId="edit_1" editing onController={(next) => { controller = next; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    act(() => controller!.send({ type: STORY_ANNOTATIONS_MESSAGE, mode: 'on', pins: [{ id: 'pin1', path: '0', key: null }] }));
    await waitFor(() => expect(story.querySelector('[data-mx-ast="0"]')).toHaveAttribute('data-mx-annotated'));
  });
  it('replaces an unsaved draft with the server compiled story in the same adopted root', async () => {
    const { story, islands } = servePage();
    let controller: StoryController | null = null;
    const initial = parseJsxOrThrow('<h1>Title</h1>').nodes;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={initial} editId="edit_1" editing onController={(next) => { controller = next; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    const previewHtml = '<!doctype html><html><head><style data-mx-story-css>h1{color:red}</style></head><body><div data-mx-inline-story="" class="light"><h1 data-mx-ast="0">Unsaved</h1></div></body></html>';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ html: previewHtml }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const next = parseJsxOrThrow('<h1>Unsaved</h1>').nodes;
    await act(async () => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: next, source: '<h1>Unsaved</h1>', editId: 'edit_2' } as Parameters<StoryController['update']>[0]); });
    await waitFor(() => expect(story).toHaveTextContent('Unsaved'));
    expect(story.isConnected).toBe(true);
    expect(mountedDrafts.at(-1)).toEqual(next);
    expect(fetch).toHaveBeenCalledWith('/a/story1/draft-preview', expect.objectContaining({ method: 'POST' }));
    const previewCalls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(previewCalls[0]?.[1]?.body))).toMatchObject({ editId: 'edit_2' });
  });

  it('keeps a focused prose region intact until its editor loses focus', async () => {
    const { story, islands } = servePage();
    let controller: StoryController | null = null;
    const nodes = parseJsxOrThrow('<h1>Title</h1>').nodes;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={nodes} editId="edit_1" editing onController={(next) => { controller = next; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    const editor = document.createElement('input');
    editor.setAttribute('data-mx-edit-region', '0');
    story.append(editor);
    editor.focus();
    const previewHtml = '<!doctype html><html><body><div data-mx-inline-story=""><h1 data-mx-ast="0">Remote echo</h1></div></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ html: previewHtml }), { status: 200 })));
    await act(async () => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes, source: '<h1>Remote echo</h1>' }); });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(story).toHaveTextContent('Title');
    editor.blur();
    await waitFor(() => expect(story).toHaveTextContent('Remote echo'));
  });

  it('shows a remote draft after a quiet interval even when the editor retains focus', async () => {
    const { story, islands } = servePage();
    let controller: StoryController | null = null;
    const nodes = parseJsxOrThrow('<h1>Title</h1>').nodes;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={nodes} editId="edit_1" editing onController={(next) => { controller = next; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    const editor = document.createElement('input');
    editor.setAttribute('data-mx-edit-region', '0');
    story.append(editor);
    editor.focus();
    const previewHtml = '<!doctype html><html><body><div data-mx-inline-story=""><h1 data-mx-ast="0">Remote content</h1></div></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ html: previewHtml }), { status: 200 })));
    await act(async () => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes, source: '<h1>Remote content</h1>' }); });
    await waitFor(() => expect(story).toHaveTextContent('Remote content'), { timeout: 1500 });
  });

  it('keeps an unchanged compiled chart when a remote edit changes nearby prose', async () => {
    const story = document.createElement('div');
    story.setAttribute('data-mx-inline-story', '');
    story.innerHTML = '<p id="total" data-mx-ast="0">Total: 42</p><div id="chart" data-mx-ast="1" data-hk="s0-0"><svg aria-label="drawn chart"></svg></div>';
    document.body.append(story);
    const chart = story.querySelector('#chart')!;
    const initial = parseJsxOrThrow('<p id="total">Total: 42</p><Question id="chart" data="$rows" />').nodes;
    const next = parseJsxOrThrow('<p id="total">Agent total: 42</p><Question id="chart" data="$rows" />').nodes;
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={null} nodes={initial} editId="edit_1" editing onController={(value) => { controller = value; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    const previewHtml = '<!doctype html><html><body><div data-mx-inline-story=""><p id="total" data-mx-ast="0">Agent total: 42</p><div id="chart" data-mx-ast="1" data-hk="s1-0">Placeholder</div></div></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ html: previewHtml }), { status: 200 })));
    await act(async () => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: next, source: '<p id="total">Agent total: 42</p><Question id="chart" data="$rows" />' }); });
    await waitFor(() => expect(story).toHaveTextContent('Agent total: 42'));
    expect(story.querySelector('#chart')).toBe(chart);
    expect(story.querySelector('svg[aria-label="drawn chart"]')).not.toBeNull();
  });

  it('keeps an unlabelled component by its body path when the source has a Helmet', async () => {
    const story = document.createElement('div');
    story.setAttribute('data-mx-inline-story', '');
    story.innerHTML = '<p data-mx-ast="0">Total: 42</p><div data-mx-ast="1" data-hk="s0-0" aria-label="Question embed"><svg class="marks"></svg></div>';
    document.body.append(story);
    const source = '<Helmet><Value name="rows" type="table" /></Helmet><p>Total: 42</p><Question data="$rows" />';
    const initial = parseJsxOrThrow('<Helmet><Value name="rows" type="table" /></Helmet><p>Total: 42</p><Question data="$rows" id="served-shape" />').nodes;
    const next = parseJsxOrThrow('<Helmet><Value name="rows" type="table" /></Helmet><p>Agent total: 42</p><Question data="$rows" />').nodes;
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={null} nodes={initial} source={source} editId="edit_1" editing onController={(value) => { controller = value; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    const html = '<!doctype html><html><body><div data-mx-inline-story=""><p data-mx-ast="0">Agent total: 42</p><div data-mx-ast="1" data-hk="s1-0">Placeholder</div></div></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ html }), { status: 200 })));
    await act(async () => { controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: next,
      source: '<Helmet><Value name="rows" type="table" /></Helmet><p>Agent total: 42</p><Question data="$rows" />' }); });
    await waitFor(() => expect(story).toHaveTextContent('Agent total: 42'));
    expect(story.querySelector('svg.marks')).not.toBeNull();
  });

  it('keeps a chart painted while the live island runtime is disposed for editing', async () => {
    const { story, island, islands } = servePage();
    island.innerHTML = '<svg aria-label="drawn chart"></svg>';
    const originalSetMode = islands.setMode;
    islands.setMode = (mode) => {
      originalSetMode(mode);
      island.replaceChildren(); // Solid's disposal can clear the hydrated drawing.
    };
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={parseJsxOrThrow('<h1>Title</h1><Question id="island" />').nodes}
      editing onController={(value) => { controller = value; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    expect(story.querySelector('#island')).toBe(island);
    expect(story.querySelector('svg[aria-label="drawn chart"]')).not.toBeNull();
  });

  it('detaches a chart drawing from a controller that clears its old slot after disposal', async () => {
    const { story, island, islands } = servePage();
    island.setAttribute('aria-label', 'Question embed');
    island.innerHTML = '<div data-mx-chart-state="ready"><svg class="marks"></svg></div>';
    const originalSetMode = islands.setMode;
    islands.setMode = (mode) => {
      originalSetMode(mode);
      queueMicrotask(() => island.replaceChildren());
    };
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={parseJsxOrThrow('<h1>Title</h1><Question />').nodes}
      editing onController={(value) => { controller = value; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    await Promise.resolve();
    expect(story.querySelector('svg.marks')).not.toBeNull();
  });

  it('keeps a compiled chart slot painted when its Solid wrapper is disposed', async () => {
    const { story, island, islands } = servePage();
    island.remove();
    const chart = document.createElement('div');
    chart.id = 'chart';
    chart.setAttribute('aria-label', 'Question embed');
    chart.setAttribute('data-mx-ast', '1');
    chart.innerHTML = '<svg class="marks"></svg>';
    story.append(chart);
    const originalSetMode = islands.setMode;
    islands.setMode = (mode) => { originalSetMode(mode); chart.replaceChildren(); };
    let controller: StoryController | null = null;
    render(<IslandStory id="story1" story={story} islands={islands} nodes={parseJsxOrThrow('<h1>Title</h1><Question id="chart" />').nodes}
      editing onController={(value) => { controller = value; }} />);
    act(() => controller!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    expect(story.querySelector('#chart')).not.toBe(chart);
    expect(story.querySelector('svg.marks')).not.toBeNull();
  });

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

  it('entering edit mode keeps the compiled DOM and mounts the editor by AST path', async () => {
    const { story, islands } = servePage();
    render(<ArtifactShell role="owner"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    expect(screen.getByLabelText('Artifact viewport').contains(story)).toBe(true);
    const edit = document.querySelector<HTMLElement>('[data-mx-reader-rail] [data-mx-reader-action="edit"]')!;
    await act(async () => { fireEvent.click(edit); await Promise.resolve(); });
    // The editor hook subscribes to document events before it sends this request.
    // A textbox mounted merely from the route's `editing` prop races that listener.
    expect(mountedDrafts).toHaveLength(0);
    expect(islands.events).toEqual([]);
    await waitFor(() => expect(editorRuntimeRefs.length).toBeGreaterThan(0));
    act(() => editorRuntimeRefs.at(-1)!.current!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    expect(islands.events).toEqual(['edit']);
    expect(story.isConnected).toBe(true);
    expect(screen.getByLabelText('Artifact viewport').contains(story)).toBe(true);
    expect(interpreters).toHaveLength(0);
  });

  it('starts editing from the latest live version after a compiled reader update', async () => {
    servePage();
    const props = compiledProps();
    const view = render(<ArtifactShell role="owner"><ArtifactSurface {...props} /></ArtifactShell>);
    const newer = [{ type: 'element', tag: 'h1', props: {}, children: ['Updated title'] }];
    liveFrame.current = { nodes: newer };
    view.rerender(<ArtifactShell role="owner"><ArtifactSurface {...props} /></ArtifactShell>);
    const edit = document.querySelector<HTMLElement>('[data-mx-reader-rail] [data-mx-reader-action="edit"]')!;
    await act(async () => { fireEvent.click(edit); await Promise.resolve(); });
    await waitFor(() => expect(editorRuntimeRefs.length).toBeGreaterThan(0));
    act(() => editorRuntimeRefs.at(-1)!.current!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }));
    await waitFor(() => expect(mountedDrafts).toHaveLength(1));
    expect(mountedDrafts[0]).toEqual(newer);
  });

  it('leaving the page disposes the islands without entering edit mode', async () => {
    const { story, islands } = servePage();
    const view = render(<ArtifactSurface {...compiledProps()} />);
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(islands.events).toEqual(['dispose']);
    expect(story.isConnected).toBe(false);
  });

  it('a newer version is drawn in place over the adopted islands, never by the interpreter', async () => {
    const { story, islands } = servePage();
    const view = render(<ArtifactSurface {...compiledProps()} />);
    view.rerender(<ArtifactSurface {...compiledProps()} version={2} />);
    await act(async () => { await Promise.resolve(); });
    expect(updateCompiledStory).toHaveBeenCalledTimes(1);
    expect(updateCompiledStory).toHaveBeenCalledWith(window, expect.objectContaining({ adopted: true }));
    expect(interpreters, 'a reader never gets the React interpreter for a write').toHaveLength(0);
    expect(islands.events, 'the islands keep running').toEqual([]);
    expect(screen.getByLabelText('Artifact viewport').contains(story)).toBe(true);
  });

  it('carries the reader\'s own mode and the version\'s source nodes into the update', async () => {
    servePage();
    render(<ArtifactShell role="commenter"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    const controller = (layerProps.at(-1)!.runtimeRef as { current: StoryController | null }).current!;
    controller.send({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' });
    vi.mocked(updateCompiledStory).mockClear();
    controller.update({ type: STORY_DOCUMENT_MESSAGE, nodes: [] } as never);
    expect(updateCompiledStory).toHaveBeenCalledTimes(1);
    const options = vi.mocked(updateCompiledStory).mock.calls[0]![1]!;
    expect(options.mode?.()).toBe('dark');
    expect(interpreters).toHaveLength(0);
  });

  it('a dataset wakeup re-runs the islands\' queries on their store', () => {
    const { islands } = servePage();
    const controllers: Array<StoryController | null> = [];
    // The page's controller is what AnnotationLayer is handed: a commenter's page mounts it.
    render(<ArtifactShell role="commenter"><ArtifactSurface {...compiledProps()} /></ArtifactShell>);
    const runtimeRef = layerProps.at(-1)!.runtimeRef as { current: StoryController | null };
    controllers.push(runtimeRef.current);
    runtimeRef.current!.send({ type: STORY_DATA_MESSAGE, datasets: ['sales'] });
    expect(islands.invalidated).toEqual([['sales']]);
    expect(controllers[0]!.nonce).not.toBe('interpreter');
  });

  it('a reader surface without a compiled root does not mount the editor interpreter', async () => {
    servePage();
    render(<ArtifactSurface {...surfaceProps()} />);
    await act(async () => { await Promise.resolve(); });
    expect(interpreters).toHaveLength(0);
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
