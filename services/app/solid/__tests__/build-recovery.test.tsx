/* @jsxImportSource solid-js */
/**
 * A TAB THAT OUTLIVES A DEPLOY (solid/lib/app-build, solid/components/BuildRecovery). The page's lazy chunks are
 * named by content hash and only the current build's are served, so after a deploy an old tab's next lazy import
 * 404s. The page must recover by loading the new build — once per build change, never in a loop — and, once it
 * knows the server moved on, take its next navigation as a full load before any chunk is missing.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, lazy, Suspense } from 'solid-js';
import { MemoryRouter, Route, createMemoryHistory, useNavigate } from '@solidjs/router';
import { APP_BUILD_META } from '@/lib/http/app-build';
import { buildStale, isChunkLoadError, noteServerBuild, registerBeforeReload, watchAppBuild, type BuildHost } from '@/solid/lib/app-build';
import { PageFailure, StaleBuildNavigation } from '@/solid/components/BuildRecovery';

const CHUNK_404 = () => new TypeError('Failed to fetch dynamically imported module: https://app.example.test/assets/CommentMarkdownField-Cp4XxIWn.js');

let storage: Map<string, string>;
let host: BuildHost & EventTarget & { location: { reload: ReturnType<typeof vi.fn>; assign: ReturnType<typeof vi.fn> } };
let stop: () => void;

/** A page load of build `build`: the meta the server put in it, a fresh window, the tab's session storage kept. */
function load(build: string | null) {
  stop?.();
  document.head.querySelector(`meta[name="${APP_BUILD_META}"]`)?.remove();
  if (build) document.head.insertAdjacentHTML('beforeend', `<meta name="${APP_BUILD_META}" content="${build}">`);
  const win = new EventTarget();
  host = Object.assign(win, {
    document,
    location: { reload: vi.fn(), assign: vi.fn(), href: 'https://app.example.test/@pat/w3D6Uy-notes' },
    sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } as unknown as Storage,
  }) as typeof host;
  stop = watchAppBuild(host);
  return host;
}

/** A page whose lazy part fails the way a missing chunk does, under the app's own boundary. */
const failingPage = (error: () => unknown) => {
  const Part = lazy(() => Promise.reject(error()));
  return render(() => <ErrorBoundary fallback={(e, reset) => <PageFailure error={e} reset={reset} />}><Suspense><Part /></Suspense></ErrorBoundary>);
};

beforeEach(() => { storage = new Map(); });
afterEach(() => { cleanup(); stop?.(); document.head.querySelector(`meta[name="${APP_BUILD_META}"]`)?.remove(); });

describe('a missing chunk', () => {
  it('is recognised in every engine\'s wording, and nothing else is', () => {
    expect(isChunkLoadError(CHUNK_404())).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/Document-abc.css'))).toBe(true);
    expect(isChunkLoadError(new Error('Could not load page'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('loads the new build at once, once: the same build failing again offers a Reload that works instead of looping', async () => {
    load('aaaaaaaaaaaa');
    failingPage(CHUNK_404);
    expect(await screen.findByRole('status', { name: 'Loading the latest version' })).toBeInTheDocument();
    await waitFor(() => expect(host.location.reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Retry loading page' }), 'retrying the same missing chunk can never work').toBeNull();
    cleanup();

    // The reload came back on the SAME build (the deploy kept the old page, or the chunk is really gone): no second automatic reload.
    load('aaaaaaaaaaaa');
    failingPage(CHUNK_404);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This page was updated while it was open.');
    expect(host.location.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    await waitFor(() => expect(host.location.reload).toHaveBeenCalledTimes(1));
    cleanup();

    // A later deploy is a new build change: one automatic reload again.
    load('bbbbbbbbbbbb');
    failingPage(CHUNK_404);
    await waitFor(() => expect(host.location.reload).toHaveBeenCalledTimes(1));
  });

  it('waits for registered unsaved work to flush before it reloads', async () => {
    load('aaaaaaaaaaaa');
    let release!: () => void;
    const flushed = new Promise<void>((resolve) => { release = resolve; });
    const unregister = registerBeforeReload(() => flushed);
    failingPage(CHUNK_404);
    await screen.findByRole('status', { name: 'Loading the latest version' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.location.reload, 'not while a save is in flight').not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(host.location.reload).toHaveBeenCalledTimes(1));
    unregister();
  });

  it('any other failure keeps Retry, which re-renders the page, beside Reload', async () => {
    load('aaaaaaaaaaaa');
    let fail = true;
    const Flaky = () => { if (fail) throw new Error('boom'); return <p>page body</p>; };
    render(() => <ErrorBoundary fallback={(e, reset) => <PageFailure error={e} reset={reset} />}><Flaky /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this page.');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading page' }));
    expect(await screen.findByText('page body')).toBeInTheDocument();
    expect(host.location.reload).not.toHaveBeenCalled();
  });
});

describe('a deploy the page has heard about', () => {
  const app = () => {
    const history = createMemoryHistory();
    history.set({ value: '/one' });
    let go!: (to: string) => void;
    const One = () => { go = useNavigate(); return <p>page one</p>; };
    render(() => <MemoryRouter history={history} root={(props) => <><StaleBuildNavigation />{props.children}</>}>
      <Route path="/one" component={One} />
      <Route path="/two" component={() => <p>page two</p>} />
    </MemoryRouter>);
    return { navigate: (to: string) => go(to) };
  };

  it('navigates inside the app while the server is on the page\'s own build', async () => {
    load('aaaaaaaaaaaa');
    noteServerBuild('aaaaaaaaaaaa');
    const { navigate } = app();
    navigate('/two');
    expect(await screen.findByText('page two')).toBeInTheDocument();
    expect(host.location.assign).not.toHaveBeenCalled();
  });

  it('takes the next navigation as a full load once a heartbeat or response names another build', async () => {
    load('aaaaaaaaaaaa');
    noteServerBuild('bbbbbbbbbbbb');
    expect(buildStale()).toBe(true);
    const { navigate } = app();
    navigate('/two?tab=1');
    await waitFor(() => expect(host.location.assign).toHaveBeenCalledWith('/two?tab=1'));
    expect(screen.queryByText('page two'), 'the old build never renders the next page').toBeNull();
  });

  it('a chunk that failed to load in the background (vite:preloadError) also makes the next navigation a full load', async () => {
    load('aaaaaaaaaaaa');
    const { navigate } = app();
    expect(buildStale()).toBe(false);
    host.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(buildStale()).toBe(true);
    navigate('/two');
    await waitFor(() => expect(host.location.assign).toHaveBeenCalledWith('/two'));
  });

  it('a server with no build (development) never marks the page stale', () => {
    load(null);
    noteServerBuild('bbbbbbbbbbbb');
    expect(buildStale()).toBe(false);
  });
});
