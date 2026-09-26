/**
 * The offline bundles as the download reads them: built by
 * scripts/build-offline.mjs (run by the test global setup through
 * build-story-runtime), gzip+base64 as `#afbin-code` stores them.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { offlineBundle } from '../bundle.server';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'lib/story-runtime/dist/offline/manifest.json'), 'utf8')) as {
  bundles: Record<'core' | 'mermaid', { sha256: string; raw: number; gzip: number }>;
};

describe('offlineBundle', () => {
  it.each(['core', 'mermaid'] as const)('answers the %s bundle as gzip+base64 of exactly the built code', async (kind) => {
    const code = gunzipSync(Buffer.from(await offlineBundle(kind), 'base64'));
    expect(code.length).toBe(manifest.bundles[kind].raw);
    expect(createHash('sha256').update(code).digest('hex')).toBe(manifest.bundles[kind].sha256);
    // ONE CLASSIC SCRIPT: it compiles as one, which module syntax or a stray
    // `import.meta` would not (both are SyntaxErrors outside a module).
    expect(() => new Script(code.toString('utf8'))).not.toThrow();
  });

  it('computes each bundle once per process', () => {
    expect(offlineBundle('core')).toBe(offlineBundle('core'));
  });

  it('keeps Mermaid out of the core bundle', async () => {
    // Checked on the code itself: once the editor joined both bundles, a size ratio no longer said this.
    const code = async (kind: 'core' | 'mermaid') => gunzipSync(Buffer.from(await offlineBundle(kind), 'base64')).toString('utf8');
    const [core, mermaid] = [await code('core'), await code('mermaid')];
    for (const marker of ['mermaidAPI', 'flowchart-v2']) {
      expect(mermaid).toContain(marker);
      expect(core).not.toContain(marker);
    }
    expect(core).toContain('This file was saved without diagram support.');
    // Mermaid is still megabytes a document without a diagram does not carry.
    expect(manifest.bundles.mermaid.raw - manifest.bundles.core.raw).toBeGreaterThan(3 * 1024 * 1024);
  });
});
