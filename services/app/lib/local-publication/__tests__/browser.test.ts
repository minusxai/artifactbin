import { describe, expect, it, vi } from 'vitest';
import { publishLocalDocument, publicationPlatformOrigin, receiveLocalPublication } from '../browser';

const receipt = { identity: { platformOrigin: 'https://example.test', artifactId: 'AbC123', baseRevision: '1', sourceDigest: 'a'.repeat(64) }, source: '<html>saved</html>' };
function browser() {
  let receive: ((event: MessageEvent) => void) | undefined;
  const popup = { postMessage: vi.fn<(...args: unknown[]) => void>() };
  const win = { location: { origin: 'null' }, open: vi.fn(() => popup), addEventListener: vi.fn((type, handler) => { if (type === 'message') receive = handler; }), removeEventListener: vi.fn() };
  return { popup, win: win as unknown as Window, ready: (origin: string, source: unknown, nonce: string) => receive?.({ origin, source, data: { type: 'af:local-publication', kind: 'ready', nonce } } as MessageEvent) };
}
describe('local publication popup boundary', () => {
  it('accepts only explicit platform origins without URL credentials or remote HTTP', () => {
    expect(publicationPlatformOrigin('https://example.test')).toBe('https://example.test');
    expect(publicationPlatformOrigin('http://localhost:3030')).toBe('http://localhost:3030');
    for (const value of ['https://user:password@example.test', 'https://example.test/path', 'http://example.test', 'file:///tmp/file.html']) expect(() => publicationPlatformOrigin(value)).toThrow();
  });
  it('binds a receipt to the exact popup, platform and nonce before connecting a private port', async () => {
    const b = browser(), onPublished = vi.fn();
    const control = publishLocalDocument({ win: b.win, platformOrigin: 'https://example.test', onPublished });
    const url = new URL(vi.mocked(b.win.open).mock.calls[0]![0] as string);
    const nonce = new URLSearchParams(url.hash.slice(1)).get('af_nonce')!;
    expect(url.pathname).toBe('/local/publish');
    b.ready('https://evil.test', b.popup, nonce);
    b.ready('https://example.test', {}, nonce);
    b.ready('https://example.test', b.popup, 'wrong');
    expect(b.popup.postMessage).not.toHaveBeenCalled();
    b.ready('https://example.test', b.popup, nonce);
    b.ready('https://example.test', b.popup, nonce);
    expect(b.popup.postMessage).toHaveBeenCalledTimes(1);
    const port = (b.popup.postMessage.mock.calls[0]![2] as MessagePort[])[0] as MessagePort;
    port.postMessage({ type: 'af:local-publication', kind: 'published', nonce: 'wrong', receipt });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onPublished).not.toHaveBeenCalled();
    port.postMessage({ type: 'af:local-publication', kind: 'published', nonce, receipt });
    await vi.waitFor(() => expect(onPublished).toHaveBeenCalledWith(receipt));
    control.dispose(); port.close();
  });
  it('reports a blocked popup without attempting publication', () => {
    const b = browser(); vi.mocked(b.win.open).mockReturnValue(null);
    expect(() => publishLocalDocument({ win: b.win, platformOrigin: 'https://example.test', onPublished: vi.fn() })).toThrow(/popup/i);
  });
});

describe('platform receiver local opener boundary', () => {
  function receiver(origin: string) {
    let handler: ((event: MessageEvent) => void) | undefined;
    const opener = { postMessage: vi.fn() };
    const win = { location: { origin: 'https://example.test', hash: new URLSearchParams({ af_nonce: 'abcdefghijklmnop', af_opener: origin }).toString() }, opener, addEventListener: vi.fn((_type, value) => { handler = value; }), removeEventListener: vi.fn() };
    win.location.hash = '#' + win.location.hash;
    return { win: win as unknown as Window, opener, connect: (port: unknown, patch = {}) => handler?.({ source: opener, origin, data: { type: 'af:local-publication', kind: 'connect', nonce: 'abcdefghijklmnop' }, ports: [port], ...patch } as unknown as MessageEvent) };
  }
  it('never connects a foreign website or malformed opener', () => {
    for (const origin of ['https://foreign.test', 'http://foreign.test', 'https://localhost.evil.test', 'not a URL']) {
      const b = receiver(origin); const control = receiveLocalPublication({ win: b.win });
      expect(b.opener.postMessage).not.toHaveBeenCalled(); expect(control.send(receipt)).toBe(false); control.dispose();
    }
  });
  it('accepts one exact local connection and stops sending after disposal', () => {
    for (const origin of ['null', 'http://localhost:3000', 'http://127.0.0.1:3000', 'https://[::1]:3000']) {
      const b = receiver(origin), onConnected = vi.fn();
      const control = receiveLocalPublication({ win: b.win, onConnected });
      const first = { postMessage: vi.fn(), close: vi.fn() }, second = { postMessage: vi.fn(), close: vi.fn() };
      b.connect(first, { origin: 'https://foreign.test' }); b.connect(first, { source: {} });
      b.connect(first, { data: { type: 'af:local-publication', kind: 'connect', nonce: 'wrong' } });
      expect(onConnected).not.toHaveBeenCalled();
      b.connect(first); b.connect(second); expect(onConnected).toHaveBeenCalledTimes(1);
      expect(control.send(receipt)).toBe(true); expect(first.postMessage).toHaveBeenCalledTimes(1); expect(second.postMessage).not.toHaveBeenCalled();
      control.dispose(); expect(first.close).toHaveBeenCalled(); expect(control.send(receipt)).toBe(false);
    }
  });
  it('cleans up a closed popup without accepting late success', () => {
    vi.useFakeTimers();
    try {
      const b = browser(), onPublished = vi.fn(); const control = publishLocalDocument({ win: b.win, platformOrigin: 'https://example.test', onPublished });
      Object.assign(b.popup, { closed: true }); vi.advanceTimersByTime(500);
      expect(b.win.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function)); expect(onPublished).not.toHaveBeenCalled(); control.dispose();
    } finally { vi.useRealTimers(); }
  });
});

it('opens publication with cryptographic bytes when randomUUID is unavailable, and fails clearly without crypto', () => {
  const bytes = vi.fn((target: Uint8Array) => { target.fill(0xab); return target; });
  vi.stubGlobal('crypto', { getRandomValues: bytes });
  try {
    const b = browser(); const control = publishLocalDocument({ win: b.win, platformOrigin: 'https://example.test', onPublished: vi.fn() });
    expect(bytes).toHaveBeenCalled();
    const nonce = new URLSearchParams(new URL(vi.mocked(b.win.open).mock.calls[0]![0] as string).hash.slice(1)).get('af_nonce');
    expect(nonce).toMatch(/^[a-f0-9-]{36}$/); control.dispose();
    vi.stubGlobal('crypto', undefined);
    expect(() => publishLocalDocument({ win: b.win, platformOrigin: 'https://example.test', onPublished: vi.fn() })).toThrow(/Secure browser randomness/);
  } finally { vi.unstubAllGlobals(); }
});
