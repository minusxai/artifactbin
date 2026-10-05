import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { REPO, ROSTER, loadSpec } from '../../design-systems/lib/pages.mjs';
import { previewDocument } from '../generate-design-system-previews.mjs';

describe('shared design-system thumbnails', () => {
  it('renders the original cover, title and mode tokens with generation-only local font routes', () => {
    for (const slug of ROSTER) {
      const spec = loadSpec(slug);
      const light = previewDocument(spec, 'light');
      const dark = previewDocument(spec, 'dark');
      expect(light.html).toContain(`<div class="name">${spec.name}</div>`);
      expect(light.html).toContain('viewBox=');
      expect(light.html).not.toContain('https://');
      expect(light.fonts.size).toBeGreaterThan(0);
      for (const [local, url] of light.fonts) {
        expect(local).toMatch(/^\/fonts\/[a-f0-9]{64}\.woff2$/);
        expect(url).toMatch(/^https:\/\/fonts\.gstatic\.com\//);
      }
      expect(dark.html).not.toBe(light.html);
    }
    expect(previewDocument(loadSpec('dossier'), 'light').html).toContain('.do-paper { fill: var(--ds-paper); }');
    expect(previewDocument(loadSpec('redline'), 'light').html).toContain('.rl-paper { fill: var(--ds-paper); }');
  });
  it('ships every light/dark thumbnail as a compact 2x WebP', async () => {
    for (const slug of ROSTER) for (const suffix of ['', '-dark']) {
      const bytes = readFileSync(path.join(REPO, 'services/app/public/design-systems', `${slug}${suffix}.webp`));
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 480, height: 436 });
      expect(bytes.length).toBeLessThan(40_000);
    }
  });
});
