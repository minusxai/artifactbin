/**
 * ONE CALLER CANNOT STARVE OR REACH INTO THE SHARED BROWSER, in a real Chromium: a check that never yields, or one
 * past its memory or thread limit, delays and fails no export (checks have their own browser, and a renderer past
 * ./src/render-limits is stopped alone); Chromium is started with none of this process's secrets; and with
 * BROWSER__RENDER_SANDBOX=chromium it runs in its own sandbox, or the service refuses to start, by name.
 */
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createBrowser, chromiumEnv } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { RENDER_LIMITS, processTable } from '../src/render-limits';

const PAGES: Record<string, string> = {
  '/plain': '<!doctype html><html><body><h1>Plain</h1></body></html>',
  '/spin': '<!doctype html><html><body><h1>Spin</h1><script>setTimeout(() => { for (;;) {} }, 50);</script></body></html>',
  '/memory': '<!doctype html><html><body><h1>Memory</h1><script>const keep = []; setInterval(() => { const a = new Uint8Array(64 << 20); a.fill(1); keep.push(a); }, 20);</script></body></html>',
  '/workers': `<!doctype html><html><body><h1>Workers</h1><script>
const source = URL.createObjectURL(new Blob(['const a = new Uint8Array(16 << 20); a.fill(1); setInterval(() => a[0]++, 10);'], { type: 'text/javascript' }));
const all = []; for (let i = 0; i < 100; i++) all.push(new Worker(source));
</script></body></html>`,
};
let site: RunningServer;
beforeAll(async () => {
  site = await withHttpServer((request, response) => {
    const body = PAGES[request.url ?? ''];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }); response.end(body ?? '');
  });
});
afterAll(async () => { await site.close(); });

const page = (path: string, timeoutMs = 15_000) => ({ url: `${site.base}${path}`, viewport: { width: 800, height: 600 }, selector: 'body', sameOriginOnly: true, settleMs: 300, timeoutMs });
const shot = (path: string) => ({ ...page(path), format: 'png' as const, capture: 'full' as const });

it('a check that never yields delays no export: checks draw in their own browser', async () => {
  const chromium = createBrowser();
  try {
    const check = chromium.inspect!({ ...page('/spin', 12_000), internalOrigin: site.base });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const started = Date.now();
    const exported = await chromium.render(shot('/plain'));
    expect(exported.ok).toBe(true);
    // Far inside the spinning check's own deadline: the export never waited for it.
    expect(Date.now() - started).toBeLessThan(8_000);
    const checked = await check;
    expect(checked.ok && checked.problems.map((problem) => problem.kind)).toEqual(['timeout']);
  } finally { await chromium.close(); }
}, 60_000);

it('a page past its memory or its thread limit is stopped alone, said as its problem, while an export goes on', async () => {
  const chromium = createBrowser({ limits: { bytes: 700 * 1024 * 1024, threads: 64 } });
  try {
    for (const path of ['/memory', '/workers']) {
      const [checked, exported] = await Promise.all([chromium.inspect!({ ...page(path, 20_000), settleMs: 6_000, internalOrigin: site.base }), chromium.render(shot('/plain'))]);
      expect(exported.ok, path).toBe(true);
      expect(checked.ok && checked.problems, path).toEqual(expect.arrayContaining([{ kind: 'script', message: expect.stringMatching(/^the page was stopped: it used more than 700 MB of memory or 64 threads/) }]));
      // Its browser lives on: the next check of a plain page is answered.
      const after = await chromium.inspect!({ ...page('/plain'), internalOrigin: site.base });
      expect(after, path).toMatchObject({ ok: true, problems: [] });
    }
  } finally { await chromium.close(); }
}, 120_000);

it('leaves an ordinary page far inside the limits it is held to', async () => {
  const chromium = createBrowser();
  try {
    const rendering = chromium.render({ ...shot('/plain'), settleMs: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const rows = await processTable();
    const browsers = new Set(rows.filter((row) => row.ppid === process.pid && row.command.includes('--artifactbin-render-lane=')).map((row) => row.pid));
    const under = (pid: number): boolean => { const row = rows.find((one) => one.pid === pid); return !!row && (browsers.has(row.ppid) || under(row.ppid)); };
    const renderers = rows.filter((row) => row.command.includes('--type=renderer') && under(row.pid));
    expect((await rendering).ok).toBe(true);
    expect(renderers.length).toBeGreaterThan(0);
    process.stdout.write(`plain renderer: ${renderers.map((row) => `${Math.round(row.bytes / 1048576)} MB, ${row.threads ?? '?'} threads`).join('; ')}\n`);
    for (const renderer of renderers) {
      expect(renderer.bytes).toBeLessThan(RENDER_LIMITS.bytes / 4);
      if (renderer.threads !== null) expect(renderer.threads).toBeLessThan(RENDER_LIMITS.threads / 2);
    }
  } finally { await chromium.close(); }
}, 60_000);

it('starts Chromium with only what it needs of the environment, never this process\'s secrets', async () => {
  expect(chromiumEnv({ PATH: '/bin', HOME: '/home/x', INTERNAL__SERVICE_SECRET: 's', AUTH__SECRET: 'a', S3_URL: 'https://k:s@x' })).toEqual({ PATH: '/bin', HOME: '/home/x' });
  // Read from the running browser's own processes where the system shows them (Linux /proc; macOS hides another process's environment).
  if (process.platform !== 'linux') return;
  const sentinel = `sentinel-${Date.now()}`;
  process.env.ARTIFACTBIN_TEST_SECRET = sentinel;
  const chromium = createBrowser();
  try {
    let seen: string[] = [];
    const rendering = chromium.render({ ...shot('/plain'), settleMs: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const rows = await processTable();
    const ours = rows.filter((row) => row.ppid === process.pid && row.command.includes('--artifactbin-render-lane='));
    seen = await Promise.all(ours.map((row) => readFile(`/proc/${row.pid}/environ`, 'utf8').catch(() => '')));
    expect((await rendering).ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    for (const environ of seen) { expect(environ).toContain('PATH='); expect(environ).not.toContain(sentinel); }
  } finally { delete process.env.ARTIFACTBIN_TEST_SECRET; await chromium.close(); }
}, 60_000);

it('runs renders in Chromium\'s own sandbox when asked, and refuses to start, by name, where it cannot', async () => {
  const sandboxed = createBrowser({ sandbox: { mode: 'chromium' } });
  try {
    await sandboxed.start();
    const rendering = sandboxed.render({ ...shot('/plain'), settleMs: 1_500 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const browsers = (await processTable()).filter((row) => row.ppid === process.pid && row.command.includes('--artifactbin-render-lane='));
    expect((await rendering).ok).toBe(true);
    expect(browsers.length).toBeGreaterThan(0);
    for (const browser of browsers) expect(browser.command).not.toContain('--no-sandbox');
  } finally { await sandboxed.close(); }
  const unable = createBrowser({ sandbox: { mode: 'chromium' }, executablePath: async () => '/nonexistent/chromium' });
  await expect(unable.start()).rejects.toThrow(/^BROWSER__RENDER_SANDBOX=chromium, but Chromium could not start inside its sandbox .*set BROWSER__RENDER_SANDBOX=none to accept rendering without it\.$/s);
  await unable.close();
}, 60_000);
