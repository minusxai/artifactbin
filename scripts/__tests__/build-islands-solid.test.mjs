/**
 * The island build's Solid toolchain (scripts/build-islands.mjs `solidPlugin`): the contract's
 * `solid-js/web` / `solid-js/store` resolve to Solid 2.0, the JSX transform emits code the PINNED
 * runtime runs (a transform from another release candidate renders but drops event handlers), and
 * the graph holds exactly one Solid.
 */
import { describe, expect, it } from 'vitest';
import esbuild from 'esbuild';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { solidPlugin } from '../build-islands.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE = path.join(ROOT, 'services/app/lib/islands/__tests__/fixtures/counter.tsx');

async function bundle(options) {
  return esbuild.build({ absWorkingDir: ROOT, entryPoints: [FIXTURE], bundle: true, format: 'esm', platform: 'browser', write: false, metafile: true, logLevel: 'silent', plugins: [solidPlugin(options)] });
}

describe('solidPlugin', () => {
  it('compiles Solid JSX that the pinned runtime renders and updates', async () => {
    const out = await bundle({ generate: 'dom', hydratable: false });
    const dom = new JSDOM('<div id="host"></div>');
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document });
    try {
      const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
      const host = dom.window.document.getElementById('host');
      const dispose = mod.render(() => mod.Counter({ label: 'Count' }), host);
      expect(host.textContent).toBe('Count: 0 clicks');
      host.querySelector('button').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(host.textContent).toBe('Count: 1 clicks');
      dispose();
    } finally {
      Object.assign(globalThis, saved);
    }
  });

  it('resolves the contract specifiers to one Solid 2.0 and emits hydratable code for the build', async () => {
    const out = await bundle({ generate: 'dom', hydratable: true });
    const packages = new Set(Object.keys(out.metafile.inputs).map((i) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(i)?.[1]).filter(Boolean));
    expect([...packages].filter((p) => /solid/.test(p)).sort()).toEqual(['@solidjs/signals', '@solidjs/web', 'solid-js']);
    expect(Object.keys(out.metafile.inputs).some((i) => i.endsWith('lib/islands/solid-store.ts'))).toBe(true);
    expect(out.outputFiles[0].text).toMatch(/getNextElement|claimElement/);
  });
});
