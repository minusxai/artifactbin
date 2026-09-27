/**
 * Sharing and the comment layer are ON-DEMAND chunks (lib/dynamic `onDemand`):
 * a reader of a document never downloads them (lib/__tests__/reader-bundle-hygiene),
 * and the people who use them never wait for them.
 *
 *  - WARMED: for an owner or editor, sharing is fetched once the page is idle,
 *    and again the moment they reach for a control that opens it. A reader's
 *    page schedules nothing and reaching for the same controls fetches nothing.
 *  - NEVER A DEAD CLICK: pressed before its code lands, a feature opens its REAL
 *    frame at once — the Sharing dialog, the Annotation sidebar — busy, and the
 *    content replaces the skeleton in place.
 *  - A FAILED DOWNLOAD says so, with Retry, and Retry downloads it again.
 *
 * Downloads are driven through the features' own `load`/`loaded`, so each test
 * decides exactly when (and whether) the code arrives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import type { InlineStoryController, InlineStoryRuntimeProps } from '@/lib/story-runtime/InlineStoryRuntime';
import { STORY_SELECTION_ACTION_MESSAGE } from '@/lib/story-runtime/contract';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface from '../ArtifactSurface';
import { shareLinkFeature } from '../ShareLinkOnDemand';
import AnnotationLayerOnDemand, { annotationLayerFeature } from '../AnnotationLayerOnDemand';
import type { OnDemand } from '@/lib/dynamic';

vi.mock('@/lib/story-runtime/InlineStoryRuntime', () => ({
  InlineStoryRuntime: ({ onController }: InlineStoryRuntimeProps) => {
    useLayoutEffect(() => {
      const controller = {
        nonce: 'n'.repeat(32), send: vi.fn(), update: vi.fn(), invalidate: vi.fn(),
        subscribe: () => () => {}, getViewportRect: () => new DOMRect(), dispose: () => {},
      } as unknown as InlineStoryController;
      onController(controller);
      return () => onController(null);
    }, [onController]);
    return <div data-mx-inline-story><p>Document body</p></div>;
  },
}));
// The page's own layer is not under test in the sharing cases.
vi.mock('@/components/AnnotationLayer', () => ({ default: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Take over a feature's download: `arrive` lands it, `fail` rejects the current attempt. */
function control<M>(feature: OnDemand<M>, module: () => Promise<M>) {
  let arrived: M | undefined;
  let attempt = deferred<void>();
  const load = vi.spyOn(feature, 'load').mockImplementation(() => attempt.promise.then(async () => (arrived = await module())));
  vi.spyOn(feature, 'loaded').mockImplementation(() => arrived);
  return {
    load,
    arrive: () => act(async () => { attempt.resolve(); await attempt.promise; await Promise.resolve(); }),
    fail: () => act(async () => { const failing = attempt; attempt = deferred<void>(); failing.reject(new Error('chunk gone')); await failing.promise.catch(() => {}); }),
  };
}

beforeEach(() => {
  setupSurface();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/sharing')
    ? new Response(JSON.stringify({ visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: true }))
    : new Response('{}')));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('warming sharing', () => {
  it('an owner fetches it when idle and when reaching for its controls; a reader never does', async () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', vi.fn((task: () => void) => { idle.push(task); return idle.length; }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const prefetch = vi.spyOn(shareLinkFeature, 'prefetch').mockImplementation(() => {});

    const reader = render(<ArtifactShell role="viewer"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
    await screen.findByText('Document body');
    fireEvent.pointerOver(await screen.findByLabelText('Open artifact controls'));
    fireEvent.focus(screen.getByLabelText('Open artifact controls'));
    expect(idle).toEqual([]);
    expect(prefetch).not.toHaveBeenCalled();
    reader.unmount();

    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
    await screen.findByText('Document body');
    expect(prefetch).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    act(() => idle[0]!());
    expect(prefetch).toHaveBeenCalledTimes(1);

    fireEvent.pointerOver(screen.getByLabelText('Open artifact controls'));
    expect(prefetch).toHaveBeenCalledTimes(2);
    fireEvent.focus(screen.getByLabelText('Share'));
    expect(prefetch).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(screen.getByLabelText('Share'));
    expect(prefetch).toHaveBeenCalledTimes(4);
  });
});

describe('sharing pressed before its code arrives', () => {
  it('opens the real Sharing dialog at once, busy, and the real content replaces the skeleton', async () => {
    const share = control(shareLinkFeature, () => import('@/components/ShareLink'));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
    await screen.findByText('Document body');

    fireEvent.click(screen.getByLabelText('Share'));
    const dialog = screen.getByRole('dialog', { name: 'Sharing' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('status', { name: 'Loading sharing' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Share “Document”' })).toBeInTheDocument();

    await share.arrive();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sharing' })).not.toHaveAttribute('aria-busy'));
    const real = screen.getByRole('dialog', { name: 'Sharing' });
    expect(screen.getAllByRole('dialog', { name: 'Sharing' })).toHaveLength(1);
    expect(within(real).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(await within(real).findByRole('button', { name: 'Make unlisted' })).toBeInTheDocument();
    expect(share.load).toHaveBeenCalled();
  });

  it('opens from the settings row too: the row is busy, and pressing it opens the dialog when the code lands', async () => {
    const share = control(shareLinkFeature, () => import('@/components/ShareLink'));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
    await screen.findByText('Document body');
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    const row = within(await screen.findByLabelText('Owner actions')).getByRole('button', { name: 'Share' });
    expect(row).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(row);
    expect(screen.getByRole('dialog', { name: 'Sharing' })).toHaveAttribute('aria-busy', 'true');

    await share.arrive();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sharing' })).not.toHaveAttribute('aria-busy'));
    const real = screen.getByRole('dialog', { name: 'Sharing' });
    expect(within(real).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('says a failed download failed, and Retry downloads it again', async () => {
    const share = control(shareLinkFeature, () => import('@/components/ShareLink'));
    render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
    await screen.findByText('Document body');
    fireEvent.click(screen.getByLabelText('Share'));
    await share.fail();

    const dialog = screen.getByRole('dialog', { name: 'Sharing' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not load sharing.');
    const calls = share.load.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry loading sharing' }));
    expect(share.load.mock.calls.length).toBeGreaterThan(calls);
    await share.arrive();
    const real = await screen.findByRole('dialog', { name: 'Sharing' });
    await waitFor(() => expect(within(real).getByRole('button', { name: 'Copy link' })).toBeInTheDocument());
    expect(within(real).queryByRole('alert')).toBeNull();
  });
});

describe('comments opened before the comment layer arrives', () => {
  const layerProps: Array<Record<string, unknown>> = [];
  const FakeLayer = (props: Record<string, unknown>) => {
    layerProps.push(props);
    return props.railOpen ? <aside aria-label="Annotation sidebar"><p>open threads</p></aside> : null;
  };
  const baseProps = (over: Partial<Parameters<typeof AnnotationLayerOnDemand>[0]> = {}) => ({
    id: 'story1', sessionNonce: 'n'.repeat(32), railOpen: true, liveAnnotations: null, showViewComments: true,
    onRailOpenChange: vi.fn(), topOffset: 44, ...over,
  });
  beforeEach(() => { layerProps.length = 0; });

  it('draws the real rail frame at once, busy, then the layer replaces it', async () => {
    const layer = control(annotationLayerFeature, async () => ({ default: FakeLayer }) as never);
    const onRailOpenChange = vi.fn();
    render(<AnnotationLayerOnDemand {...baseProps({ onRailOpenChange })} />);
    const rail = screen.getByRole('complementary', { name: 'Annotation sidebar' });
    expect(rail).toHaveAttribute('aria-busy', 'true');
    expect(within(rail).getByRole('status', { name: 'Loading comments' })).toBeInTheDocument();
    fireEvent.click(within(rail).getByRole('button', { name: 'Close comments' }));
    expect(onRailOpenChange).toHaveBeenCalledWith(false);

    await layer.arrive();
    const real = screen.getByRole('complementary', { name: 'Annotation sidebar' });
    expect(real).not.toHaveAttribute('aria-busy');
    expect(within(real).getByText('open threads')).toBeInTheDocument();
  });

  it('holds a Select pressed in the document and hands it to the layer on arrival', async () => {
    const layer = control(annotationLayerFeature, async () => ({ default: FakeLayer }) as never);
    const listeners = new Set<(data: unknown) => void>();
    const runtimeRef = { current: { subscribe: (fn: (data: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as InlineStoryController };
    render(<AnnotationLayerOnDemand {...baseProps({ railOpen: false, runtimeRef })} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { for (const fn of listeners) fn({ type: STORY_SELECTION_ACTION_MESSAGE, nonce: 'n'.repeat(32), action: 'select', selection: null }); });
    expect(screen.getByRole('status', { name: 'Loading comments' })).toBeInTheDocument();

    await layer.arrive();
    expect(layerProps.at(-1)).toMatchObject({ pickRequested: true });
    expect(screen.queryByRole('status', { name: 'Loading comments' })).toBeNull();
  });

  it('says a failed download failed, and Retry downloads it again', async () => {
    const layer = control(annotationLayerFeature, async () => ({ default: FakeLayer }) as never);
    render(<AnnotationLayerOnDemand {...baseProps()} />);
    await layer.fail();
    const rail = screen.getByRole('complementary', { name: 'Annotation sidebar' });
    expect(within(rail).getByRole('alert')).toHaveTextContent('Could not load comments.');
    fireEvent.click(within(rail).getByRole('button', { name: 'Retry loading comments' }));
    await layer.arrive();
    expect(within(screen.getByRole('complementary', { name: 'Annotation sidebar' })).getByText('open threads')).toBeInTheDocument();
  });
});
