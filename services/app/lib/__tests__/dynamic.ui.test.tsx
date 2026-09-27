/**
 * The dynamic shim is browser-only by contract: on the
 * SERVER it renders the fallback and never suspends — a boundary the server
 * cannot resolve is React #419, which discards the whole tree and re-renders
 * the root — and in the browser it swaps in the real component after mount.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dynamic, { onDemand, useOnDemand, whenIdle, type OnDemand } from '@/lib/dynamic';

const Late = dynamic(async () => ({ default: () => <p>the real pane</p> }), { loading: () => <p>loading…</p> });

describe('dynamic()', () => {
  it('renders the fallback on the server, without suspending', () => {
    const html = renderToString(<Late />);
    expect(html).toContain('loading…');
    expect(html).not.toContain('the real pane');
  });

  it('swaps in the component in the browser', async () => {
    render(<Late />);
    await waitFor(() => expect(screen.getByText('the real pane')).toBeTruthy());
  });

  it('renders a pane whose code already arrived on the first browser commit, never its fallback', async () => {
    const Ready = dynamic(async () => ({ default: () => <p>the ready pane</p> }), { ssr: false, loading: () => <p>still loading…</p> });
    await Ready.preload();
    const drawn: string[] = [];
    const observer = new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) drawn.push(n.textContent ?? ''); });
    observer.observe(document.body, { childList: true, subtree: true });
    render(<Ready />);
    expect(screen.getByText('the ready pane')).toBeTruthy();
    await act(async () => {});
    drawn.push(...observer.takeRecords().flatMap(r => [...r.addedNodes].map(n => n.textContent ?? '')));
    observer.disconnect();
    expect(drawn.some(text => text.includes('still loading…'))).toBe(false);
  });

  it('hydrates its server fallback first, even with the code already here, then swaps the pane in', async () => {
    const Ready = dynamic(async () => ({ default: () => <p>the hydrated pane</p> }), { ssr: false, loading: () => <p>server fallback</p> });
    await Ready.preload();
    const host = document.createElement('div');
    host.innerHTML = renderToString(<Ready />);
    document.body.appendChild(host);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    await act(async () => { hydrateRoot(host, <Ready />, { onRecoverableError: (e) => errors.push(e) }); });
    await waitFor(() => expect(host.textContent).toBe('the hydrated pane'));
    expect(errors).toEqual([]);
    spy.mockRestore();
    host.remove();
  });
});

/**
 * onDemand: a feature a reader does not need to read, fetched when it is about
 * to be used. One download per feature, a failed download that can be retried,
 * and a feature that has arrived rendering on the very commit it is asked for.
 */
describe('onDemand()', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const Pane = () => <p>the real pane</p>;
  function Feature({ feature }: { feature: OnDemand<{ Pane: typeof Pane }> }) {
    const { module, failed, retry } = useOnDemand(feature);
    if (module) return <module.Pane />;
    return failed
      ? <p role="alert">could not load <button aria-label="Retry loading pane" onClick={retry}>Retry</button></p>
      : <p role="status" aria-busy="true" aria-label="Loading pane" />;
  }

  it('shows the busy placeholder, then swaps in the content once, for every caller of one download', async () => {
    const gate = deferred<{ Pane: typeof Pane }>();
    const loader = vi.fn(() => gate.promise);
    const feature = onDemand(loader);
    feature.prefetch();
    render(<><Feature feature={feature} /><Feature feature={feature} /></>);
    expect(screen.getAllByRole('status', { name: 'Loading pane' })).toHaveLength(2);
    await act(async () => { gate.resolve({ Pane }); });
    expect(screen.getAllByText('the real pane')).toHaveLength(2);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('renders an arrived feature on the first commit, with no placeholder frame', async () => {
    const feature = onDemand(async () => ({ Pane }));
    await feature.load();
    const seen: string[] = [];
    function Probe() { const { module } = useOnDemand(feature); seen.push(module ? 'real' : 'placeholder'); return null; }
    render(<Probe />);
    expect(seen[0]).toBe('real');
  });

  it('says a failed download failed, and Retry downloads it again', async () => {
    let attempt = 0;
    const loader = vi.fn(async () => { if (++attempt === 1) throw new Error('chunk gone'); return { Pane }; });
    const feature = onDemand(loader);
    render(<Feature feature={feature} />);
    const retry = await screen.findByRole('button', { name: 'Retry loading pane' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('the real pane')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('never reports a missed prefetch, and a later load still asks again', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ Pane });
    const feature = onDemand(loader);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    feature.prefetch();
    await act(async () => {});
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(feature.loaded()).toBeUndefined();
    await expect(feature.load()).resolves.toEqual({ Pane });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('whenIdle()', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('waits for an idle callback bounded by a timeout, and is cancellable', () => {
    const idle = vi.fn((_task: () => void, _options?: { timeout: number }) => 7), cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const task = vi.fn();
    const stop = whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 3000 });
    idle.mock.calls[0]?.[0]();
    expect(task).toHaveBeenCalledOnce();
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer where the browser has no idle callback', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const task = vi.fn();
    const stop = whenIdle(task);
    vi.advanceTimersByTime(1499);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
    stop();
    const cancelled = vi.fn();
    whenIdle(cancelled)();
    vi.advanceTimersByTime(5000);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
