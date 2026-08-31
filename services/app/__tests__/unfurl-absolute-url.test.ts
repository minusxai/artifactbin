/**
 * A shared link must unfurl with an image a CRAWLER can fetch.
 *
 * `og:image` was a relative path, which Next resolves against `metadataBase` —
 * unset, so it fell back to the origin this process is listening on. Behind
 * the reverse proxy that is the container's own address, and production served
 * `og:image = http://localhost:3000/a/<id>/export…` to every scraper: a link
 * that unfurled with no picture anywhere it was pasted.
 *
 * The app already knows its public origin from the forwarding headers
 * (lib/http baseUrl) — everything else it prints uses it. The card must too.
 */
import { describe, expect, it, vi } from 'vitest';

const headerBag = { host: 'localhost:3000', 'x-forwarded-host': 'artifactbin.dev', 'x-forwarded-proto': 'https' };
vi.mock('@/lib/request-context', () => ({
  currentHeaders: async () => ({ get: (k: string) => (headerBag as Record<string, string>)[k.toLowerCase()] ?? null }),
  currentRequest: () => null,
  runWithRequest: <T,>(_r: unknown, fn: () => Promise<T>) => fn(),
}));

import { artifactMetadata as artifactPageMetadata } from '@/test/helpers/pages';
import type { ArtifactRow } from '@/lib/artifacts';

const row = {
  id: 'Ab3xK9', title: 'Q3 Revenue', version: 4, format: 'markup',
  source: '<h1>Q3</h1>', description: null, meta: {},
} as unknown as ArtifactRow;

describe('artifactPageMetadata', () => {
  it('points og:image at the PUBLIC origin, not the container', async () => {
    const meta = await artifactPageMetadata(row);
    const url = String(meta.openGraph?.images?.[0]?.url ?? '');
    expect(url).toBe('https://artifactbin.dev/a/Ab3xK9/export?mode=card&v=4');
    expect(url).not.toContain('localhost');
  });

  it('keeps the version in the URL, so a scraper cache cannot outlive an edit', async () => {
    const meta = await artifactPageMetadata({ ...row, version: 9 } as ArtifactRow);
    expect(String(meta.openGraph?.images?.[0]?.url)).toContain('v=9');
  });
});
