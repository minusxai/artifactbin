/**
 * Warming the editor bundle is a PREFETCH, and a prefetch owes the page two things.
 *
 * `ArtifactSurface` fetches the editor while the reader is still reading, so pressing
 * edit swaps in rather than downloading Monaco first. It scheduled that on an idle
 * callback (or a 1.5s timer) and then forgot about it, which cost twice:
 *
 *  1. the timer OUTLIVED the component. Unmounting the surface — leaving the page,
 *     or a test finishing — left a timer that would still start a module load with
 *     nothing left to receive it. In the ui suite that is an EnvironmentTeardownError
 *     ("Cannot load … after the environment was torn down"), which failed `ui tests
 *     (2/2)` on three master runs before anyone read the stack: the module named in it
 *     (lib/html/css-urls) is simply the deepest one in the editor's graph, so it is the
 *     one still loading when the environment goes away.
 *  2. a FAILED warm was an unhandled rejection. `void import(...)` has no catch, and
 *     the import can legitimately fail — the reader is offline, or a redeploy replaced
 *     the chunk this page's build names (every /story/ and /_next/ asset is
 *     content-addressed, so an old page names URLs that no longer exist). A prefetch
 *     failing is not an error: the real import, when the reader presses edit, is what
 *     gets to report.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';


/** Records the moment the editor's module graph is first pulled in. */
let editorImported = false;
vi.mock('@/components/ArtifactEditor', () => {
  editorImported = true;
  return { default: () => null };
});

import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

const PROPS: ArtifactSurfaceProps = {
  id: 'abc123',
  version: 1,
  format: 'markup',
  editId: 'e1',
  title: 'doc',
  frameSrc: '/a/abc123/raw',
} as unknown as ArtifactSurfaceProps;

class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  editorImported = false;
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  // No idle callback in jsdom, which is the 1.5s timer path — the one that outlived
  // the component. Stubbed explicitly so the test pins the branch it means to test.
  vi.stubGlobal('requestIdleCallback', undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('warming the editor bundle', () => {
  /*
   * BOTH phases in one test on purpose. The mock factory below is the signal, and a
   * factory evaluates ONCE per module registry — so two separate tests would let the
   * second read a cached editor as "never imported" and pass for the wrong reason.
   * One lifecycle, asserted before and after, cannot lie that way.
   */
  it('is cancelled with the surface, and still runs while the reader is reading', async () => {
    const { unmount } = render(<ArtifactSurface {...PROPS} />);
    unmount();
    // Well past the 1.5s the warm is scheduled for: a timer that outlived the
    // component would fetch the editor into a page that no longer exists.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(editorImported).toBe(false);

    // …and the guard must not have turned the prefetch off altogether.
    render(<ArtifactSurface {...PROPS} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(editorImported).toBe(true);
  });
});
