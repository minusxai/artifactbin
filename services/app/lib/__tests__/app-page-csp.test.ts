/**
 * THE APP PAGES CARRY A CSP, AND A DOCUMENT NEVER TAKES IT. `frame-ancestors`
 * + `object-src` + `base-uri` lock the app's own pages (the share dialog,
 * /account…) against clickjacking. It must NEVER reach an artifact address:
 * `/a/<id>/raw` sets the per-row sandbox CSP itself, and a second policy on
 * that response would replace it — which is exactly how the sandbox was once
 * wiped by a catch-all rule.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CSP, APP_INLINE_SCRIPT_HASHES, createAppServer } from '@/server/app';

const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });

describe('the app CSP', () => {
  it('admits only the exact GitHub widget frame path without trusting its scripts or connections in the app', () => {
    expect(APP_CSP.split('; ').find(d => d.startsWith('frame-src'))).toBe("frame-src 'self'");
    for (const directive of ['script-src', 'connect-src']) {
      expect(APP_CSP.split('; ').find(d => d.startsWith(directive))).not.toContain('buttons.github.io');
    }
  });
  it('locks framing and plugins on the app pages', async () => {
    expect(APP_CSP).toContain("default-src 'none'");
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).toContain("'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='");
    expect(APP_CSP.split('; ').find(d => d.startsWith('connect-src'))).toBe("connect-src 'self' blob:");
    expect(APP_CSP).toContain("frame-ancestors 'self'");
    expect(APP_CSP).toContain("object-src 'none'");
    expect(APP_CSP).toContain("base-uri 'self'");
    for (const path of ['/', '/login', '/docs-human', '/account']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).toBe(APP_CSP);
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(res.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('permissions-policy'), path).toBe('camera=(), microphone=(), geolocation=()');
    }
  });

  /*
   * `worker-src` HAS NO DEFAULT OF ITS OWN: it falls back through `child-src`
   * to `default-src`, which is `'none'` here. The source editor wires a Monaco
   * worker and reaches for it lazily — measured, nothing has asked for it yet
   * with only the HTML tokenizer loaded — so this directive is not what fixed
   * `code` mode (that was self-hosting the library the CDN used to serve). It
   * is pinned because the day something does ask, the refusal would be silent
   * and would look like a Monaco bug. Vite emits that worker as an ordinary
   * same-origin asset (`new Worker('/assets/editor.worker-<hash>.js')`,
   * measured), so `'self'` is the whole permission: NOT `blob:`, which would
   * re-admit the script-from-a-string path this policy exists to close.
   */
  it("admits the source editor's own worker, from this origin only", () => {
    const workerSrc = APP_CSP.split('; ').find((d) => d.startsWith('worker-src'));
    expect(workerSrc).toBe("worker-src 'self'");
  });

  it('admits local media previews and GLTF texture fetches without admitting blob scripts or frames', async () => {
    const response = await app.request('/');
    const directives = response.headers.get('content-security-policy')!.split('; ');
    expect(directives.find(d => d.startsWith('media-src'))).toBe("media-src 'self' blob:");
    expect(directives.find(d => d.startsWith('connect-src'))?.split(' ')).toContain('blob:');
    for (const directive of ['frame-src', 'worker-src', 'script-src']) {
      expect(directives.find(d => d.startsWith(directive))).not.toContain('blob:');
    }
  });

  it('admits only the configured development socket on the page host', async () => {
    const dev = createAppServer({ indexHtml: async () => '<html></html>', devHmrPort: 3041 });
    for (const [origin, socket] of [
      ['http://localhost:3040', 'ws://localhost:3041'],
      ['https://dev.example:3040', 'wss://dev.example:3041'],
    ]) {
      const response = await dev.request(origin + '/');
      const connections = response.headers.get('content-security-policy')!.split('; ').find(d => d.startsWith('connect-src'))!.split(' ');
      expect(connections.filter(source => /^wss?:/.test(source))).toEqual([socket]);
    }
    expect((await app.request('/')).headers.get('content-security-policy')).not.toMatch(/wss?:/);
  });

  it('allows only the known app and development bootstrap scripts inline', () => {
    expect(APP_INLINE_SCRIPT_HASHES.split(' ')).toHaveLength(2);
    expect(APP_CSP.split('; ').find((directive) => directive.startsWith('script-src'))).not.toContain("'unsafe-inline'");
  });

  /*
   * A HASH TYPED BESIDE A FILE IS A PROMISE ABOUT THAT FILE. The theme stamp
   * in web/index.html flipped its default (light -> dark) and the hash stayed
   * on the old text, so every app page's first paint was silently blocked and
   * the toggle's stored choice stopped surviving a reload. Derive it here so
   * the next edit to that script turns this red instead of the browser.
   */
  it('hashes the theme stamp that web/index.html actually carries', () => {
    const html = readFileSync(path.resolve(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const hash = createHash('sha256').update(inline[0], 'utf8').digest('base64');
    expect(APP_INLINE_SCRIPT_HASHES).toContain(`'sha256-${hash}'`);
  });

  it('serves homepage posters under the same-origin image policy', () => {
    expect(APP_CSP.split('; ').find(d => d.startsWith('img-src'))).toBe("img-src 'self' data: blob:");
  });

  it('never lands on an artifact address or a machine surface', async () => {
    for (const path of ['/a/Ab3xK9/raw', '/a/Ab3xK9/export', '/api/artifacts', '/docs/artifactbin/references/publishing.md']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).not.toBe(APP_CSP);
    }
  });
});
