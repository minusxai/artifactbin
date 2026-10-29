/** lib/data through its index: the generated font manifest, which artifactbin-server also reads by path. */
import { describe, expect, it } from 'vitest';
import { storyFontManifest } from '..';

describe('storyFontManifest', () => {
  it('maps families, the app shell and the design systems to hashed woff2 files', () => {
    const families = Object.entries(storyFontManifest.families);
    expect(families.length).toBeGreaterThan(0);
    for (const [, assets] of families) for (const asset of assets) expect(asset.url).toMatch(/^\/fonts\/[a-z0-9-]+\.[a-f0-9]{8}\.woff2$/);
    expect(storyFontManifest.app.length).toBeGreaterThan(0);
    for (const face of storyFontManifest.app) expect(face.url).toMatch(/\.woff2$/);
    expect(Object.keys(storyFontManifest.systems).length).toBeGreaterThan(0);
  });
});
