/**
 * THE BUILD AN OPEN TAB CAN LEARN (lib/http/app-build): a server serving a built tree names that build — in the
 * app page it serves (the build the page IS) and on every response (the build the server is NOW) — so a tab left
 * open across a deploy knows to load the new build at its next navigation instead of asking for a chunk that is gone.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { overrideConfig } from '@/lib/platform/config';
import { APP_BUILD_HEADER, APP_BUILD_META, appBuild, setAppBuild } from '@/lib/http';
import { createAppServer } from '../app';
import { appBuildId } from '../build-assets';

useAppHarness();
let dir = '';
const tree = (manifest: Record<string, unknown>) => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'app-build-id-'));
  mkdirSync(path.join(dir, '.vite')); mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(dir, 'solid-app.html'), '<html><head><title>app</title></head><body><div id="root"></div></body></html>');
  return dir;
};
beforeEach(() => overrideConfig({ publicBaseUrl: 'https://example.test' }));
afterEach(() => { setAppBuild(null); if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

it('is the manifest\'s hash: a rebuild that renames any chunk is a new build, the same bytes the same one', () => {
  const a = appBuildId(tree({ main: { file: 'assets/main-AAAA.js', dynamicImports: ['x'] }, x: { file: 'assets/CommentMarkdownField-Cp4XxIWn.js' } }));
  rmSync(dir, { recursive: true, force: true });
  const same = appBuildId(tree({ main: { file: 'assets/main-AAAA.js', dynamicImports: ['x'] }, x: { file: 'assets/CommentMarkdownField-Cp4XxIWn.js' } }));
  rmSync(dir, { recursive: true, force: true });
  const next = appBuildId(tree({ main: { file: 'assets/main-AAAA.js', dynamicImports: ['x'] }, x: { file: 'assets/CommentMarkdownField-Zz9YyXxW.js' } }));
  expect(a).toMatch(/^[0-9a-f]{12}$/);
  expect(same).toBe(a);
  expect(next).not.toBe(a);
  rmSync(dir, { recursive: true, force: true });
  expect(appBuildId(path.join(os.tmpdir(), 'no-such-build-tree')), 'no built tree, no build').toBeNull();
});

it('a production server names its build in the app page it serves and on every response', async () => {
  const app = createAppServer({ webDir: tree({ main: { file: 'assets/main-AAAA.js' } }) });
  const build = appBuild();
  expect(build).toMatch(/^[0-9a-f]{12}$/);
  const page = await app.request('https://example.test/login', { headers: { accept: 'text/html' } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(`<meta name="${APP_BUILD_META}" content="${build}">`);
  expect(page.headers.get(APP_BUILD_HEADER)).toBe(build);
  const data = await app.request('https://example.test/api/page/nothing-here');
  expect(data.headers.get(APP_BUILD_HEADER), 'the page\'s data fetches carry it too').toBe(build);
});

it('a development server (Vite answers the shell) names no build anywhere', async () => {
  const app = createAppServer({ indexHtml: async () => '<html><head></head><body></body></html>' });
  expect(appBuild()).toBeNull();
  const page = await app.request('https://example.test/login', { headers: { accept: 'text/html' } });
  expect(await page.text()).not.toContain(APP_BUILD_META);
  expect(page.headers.get(APP_BUILD_HEADER)).toBeNull();
});
