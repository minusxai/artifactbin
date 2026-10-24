import { describe, expect, it, vi } from 'vitest';
import { publishLocalDocument, publicationPlatformOrigin } from '../browser';

const receipt = { identity: { platformOrigin: 'https://example.test', artifactId: 'AbC123', baseRevision: '1', sourceDigest: 'a'.repeat(64) }, source: '<html>saved</html>' };
function browser() {
  let receive: ((event: MessageEvent) => void) | undefined;
  const popup = { postMessage: vi.fn() };
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
    const port = b.popup.postMessage.mock.calls[0]![2][0] as MessagePort;
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
