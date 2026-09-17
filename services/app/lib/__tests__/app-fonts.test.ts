/** The built SPA stylesheet is the behavioral seam: it is what the browser loads. */
import path from 'node:path';
import type { RolldownOutput } from 'rolldown';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

let built: Promise<string> | undefined;

/** Build without writing and return the emitted stylesheet, font faces included. */
const appStylesheet = () => (built ??= build({
  configFile: path.resolve(process.cwd(), '../../vite.config.mts'),
  build: { write: false },
}).then((result) => {
  // No `watch` option is supplied, so Vite cannot return its watcher variant.
  const outputs = (Array.isArray(result) ? result : [result]) as RolldownOutput[];
  return outputs
    .flatMap((output) => output.output)
    .flatMap((item) => item.type === 'asset' && item.fileName.endsWith('.css') ? [String(item.source)] : [])
    .join('\n');
}));

describe('the app stylesheet', () => {
  it('defines the two font variables its own tokens reference', async () => {
    const css = await appStylesheet();
    expect(css).toMatch(/--font-jb-mono:\s*["']JetBrains Mono Variable["']/);
    expect(css).toMatch(/--font-plex-sans:\s*["']IBM Plex Sans["']/);
    expect(css).toMatch(/font-family:\s*var\(--font-mono\)/);
  }, 60_000);

  it('names the families the imported packages actually provide', async () => {
    const css = await appStylesheet();
    const faces = [...css.matchAll(/@font-face\s*\{[^}]+\}/g)].map((match) => match[0]);
    expect(faces.some((face) => /font-family:\s*["']?JetBrains Mono Variable["']?/.test(face))).toBe(true);
    expect(faces.some((face) => /font-family:\s*["']?IBM Plex Sans["']?/.test(face))).toBe(true);
  }, 60_000);
});
