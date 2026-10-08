import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_CONNECT_CHANNEL } from '@artifactbin/contracts';
import { previewWorkspaceUrl } from '@artifactbin/contracts';
import { connectPreview, previewServerOrigin } from '@/lib/offline/preview-connect';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function connection(prepare = vi.fn(async () => ({ html: '<html>current edits and comments</html>', filename: 'report.jsx.html' }))) {
  const popup = { closed: false, postMessage: vi.fn(), close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  const options = { origin: 'http://localhost:7474', prepare, onStatus: vi.fn(), onError: vi.fn(), onOpened: vi.fn() };
  const cancel = connectPreview(options);
  const requestId = new URL(String(open.mock.calls.at(-1)![0])).searchParams.get('request')!;
  const send = (type: string, extra: Record<string, unknown> = {}, origin = options.origin, source: MessageEventSource = popup as unknown as Window) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data: { channel: PREVIEW_CONNECT_CHANNEL, requestId, type, ...extra } }));
  };
  return { options, popup, open, requestId, send, cancel };
}

describe('portable preview handoff', () => {
  it('opens synchronously, offers a copy once only to the chosen server and keeps its editor tab after success', async () => {
    const test = connection();
    expect(test.open).toHaveBeenCalledTimes(1);
    expect(test.options.prepare).not.toHaveBeenCalled();
    test.send('ready'); test.send('ready');
    await settle();
    expect(test.options.prepare).toHaveBeenCalledTimes(1);
    expect(test.popup.postMessage).toHaveBeenCalledExactlyOnceWith({ channel: PREVIEW_CONNECT_CHANNEL, type: 'offer', requestId: test.requestId, html: '<html>current edits and comments</html>', filename: 'report.jsx.html' }, test.options.origin);
    test.send('opened', { path: '/workspace/report.jsx' });
    expect(test.options.onOpened).toHaveBeenCalledExactlyOnceWith('http://localhost:7474/workspace/report.jsx');
    test.cancel();
    expect(test.popup.close).not.toHaveBeenCalled();
  });

  it('ignores wrong origins, windows, protocol and correlation ids', async () => {
    const test = connection();
    test.send('ready', {}, 'https://evil.example');
    test.send('ready', {}, test.options.origin, window);
    test.send('ready', { channel: 'other' });
    test.send('ready', { requestId: 'other' });
    await settle();
    expect(test.options.prepare).not.toHaveBeenCalled();
    test.send('ready'); await settle();
    expect(test.options.prepare).toHaveBeenCalledTimes(1);
    test.cancel();
  });

  it('ignores premature success and refuses redirects outside the workspace', async () => {
    const test = connection();
    test.send('opened', { path: '/workspace/report.jsx' });
    expect(test.options.onOpened).not.toHaveBeenCalled();
    test.send('ready'); await settle();
    test.send('opened', { path: '/workspace/../api/account' });
    expect(test.options.onOpened).not.toHaveBeenCalled();
    expect(test.options.onError).toHaveBeenCalledWith(expect.stringContaining('invalid editor address'));
    test.cancel();
  });

  it('cancels an in-flight flush without sending the file and removes listeners', async () => {
    let resolve!: (offer: { html: string; filename: string }) => void;
    const test = connection(vi.fn(() => new Promise((done) => { resolve = done; })));
    test.send('ready'); test.cancel();
    resolve({ html: 'private file', filename: 'private.jsx.html' }); await settle();
    test.send('ready');
    expect(test.popup.postMessage).not.toHaveBeenCalled();
    expect(test.popup.close).toHaveBeenCalledTimes(1);
    expect(test.options.prepare).toHaveBeenCalledTimes(1);
  });

  it('reports invalid source and server import failures without a successful connection', async () => {
    const invalid = connection(vi.fn(async () => { throw new Error('Fix the source before saving or connecting.'); }));
    invalid.send('ready'); await settle();
    expect(invalid.options.onError).toHaveBeenCalledWith('Fix the source before saving or connecting.');
    expect(invalid.popup.postMessage).not.toHaveBeenCalled();
    invalid.cancel();
    const server = connection();
    server.send('error', { message: 'Local changes conflict; incoming copy preserved.' });
    expect(server.options.onError).toHaveBeenCalledWith('Local changes conflict; incoming copy preserved.');
    expect(server.options.onOpened).not.toHaveBeenCalled();
    server.cancel();
  });

  it('reports blocked popups, closed tabs and timeouts', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => connectPreview({ origin: 'http://localhost:7474', prepare: vi.fn(), onStatus: vi.fn(), onError: vi.fn(), onOpened: vi.fn() })).toThrow('blocked');
    vi.useFakeTimers();
    const closed = connection(); closed.popup.closed = true; vi.advanceTimersByTime(1000);
    expect(closed.options.onError).toHaveBeenCalledWith(expect.stringContaining('closed'));
    const timed = connection(); vi.advanceTimersByTime(10 * 60_000);
    expect(timed.options.onError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    timed.cancel(); closed.cancel();
  });

  it('keeps a handed-off file available through long authentication and accepts released workspace-compatible hosted redirects', async () => {
    vi.useFakeTimers();const test=connection();test.send('ready');await settle();
    vi.advanceTimersByTime(30*60_000);
    expect(test.options.onError).not.toHaveBeenCalled();
    test.send('opened',{path:'/workspace/Ab12Cd'});
    expect(test.options.onOpened).toHaveBeenCalledWith('http://localhost:7474/workspace/Ab12Cd');
    test.cancel();
  });

  it('restricts origins and editor paths', () => {
    expect(previewServerOrigin(' https://preview.example.com ')).toBe('https://preview.example.com');
    expect(previewServerOrigin('http://localhost:7474')).toBe('http://localhost:7474');
    for (const origin of ['http://remote.example', 'https://user:secret@remote.example', 'https://remote.example/path', 'file:///tmp/report.html']) expect(() => previewServerOrigin(origin)).toThrow();
    for (const path of ['https://evil.example/workspace/report.jsx', '//evil.example/workspace/report.jsx', '/workspace/../api/account', '/workspace/a?token=x', '/workspace/a#x', '/workspace/\\evil.example/x']) expect(previewWorkspaceUrl('https://preview.example.com', path)).toBeNull();
  });
});
