import { describe, expect, it, vi } from 'vitest';
import { FONT_FILES, FONT_STYLES } from '@artifactbin/contracts';
import { fetchBrowserFontResource } from '../browser-fonts';
import { WebIngestError } from '../guard';
import type { fetchWebResource } from '../fetch';

const mockedFetch = () => vi.fn(async (_raw: string, _options: Parameters<typeof fetchWebResource>[1]) => ({
  bytes: Buffer.from('body{}'), contentType: 'text/css', finalUrl: _raw,
}));

describe('the scripted Google Fonts fetch policy', () => {
  it('uses the shared origins, fixed browser-compatible UA, and exact URL+host allowlists', async () => {
    const fetcher = mockedFetch();
    const url = `${FONT_STYLES}/css2?family=Fraunces:wght@400;700&display=swap`;
    await fetchBrowserFontResource(url, 'text/css,*/*;q=0.1', fetcher);
    const [asked, options] = fetcher.mock.calls[0]!;
    expect(asked).toBe(url);
    expect(options).toMatchObject({
      maxBytes: 2_000_000,
      timeoutMs: 10_000,
      accept: 'text/css,*/*;q=0.1',
      userAgent: expect.stringMatching(/^Mozilla\/5\.0/),
    });
    expect(options.allowHosts?.('fonts.googleapis.com')).toBe(true);
    expect(options.allowHosts?.('fonts.gstatic.com')).toBe(true);
    expect(options.allowHosts?.('fonts.googleapis.com.evil.test')).toBe(false);
    const allows = options.allowUrl!;
    expect(allows(new URL(url))).toBe(true);
    expect(allows(new URL(`${FONT_STYLES}/other?family=Fraunces`))).toBe(false);
    expect(allows(new URL(`${FONT_FILES}/s/fraunces/v31/f.woff2`))).toBe(true);
    expect(allows(new URL(`${FONT_FILES}/private/metadata`))).toBe(false);
    expect(allows(new URL('https://fonts.gstatic.com.evil.test/s/f.woff2'))).toBe(false);
  });

  it('rejects userinfo, custom ports, unrelated paths and overlong URLs before any fetch', async () => {
    const fetcher = mockedFetch();
    for (const url of [
      'https://user:pass@fonts.googleapis.com/css2?family=Fraunces',
      'https://fonts.googleapis.com:444/css2?family=Fraunces',
      `${FONT_STYLES}/css?family=Fraunces`,
      `${FONT_FILES}/private/metadata`,
      `${FONT_STYLES}/css2?${'x'.repeat(8192)}`,
    ]) await expect(fetchBrowserFontResource(url, undefined, fetcher), url).rejects.toBeInstanceOf(WebIngestError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores an unsafe Accept value and refuses a non-CSS answer', async () => {
    const fetcher = mockedFetch();
    fetcher.mockResolvedValue({ bytes: Buffer.from('<html>blocked</html>'), contentType: 'text/html', finalUrl: `${FONT_STYLES}/css2?family=Fraunces` });
    await expect(fetchBrowserFontResource(`${FONT_STYLES}/css2?family=Fraunces`, 'x'.repeat(257), fetcher)).rejects.toMatchObject({ code: 'unsupported_type' });
    expect(fetcher.mock.calls[0]![1].accept).toBe('text/css,*/*;q=0.1');
  });

  it('accepts only bytes that sniff as a font for a Google-hosted font URL', async () => {
    const fetcher = mockedFetch();
    fetcher.mockResolvedValue({ bytes: Buffer.from('wOF2font-bytes'), contentType: 'application/octet-stream', finalUrl: `${FONT_FILES}/s/fraunces/v31/f.woff2` });
    const got = await fetchBrowserFontResource(`${FONT_FILES}/s/fraunces/v31/f.woff2`, undefined, fetcher);
    expect(got.contentType).toBe('font/woff2');
  });
});
