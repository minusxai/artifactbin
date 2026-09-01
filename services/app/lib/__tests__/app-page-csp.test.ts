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
import { SHOWCASE_ORIGIN, showcaseCardUrl, SHOWCASE } from '@/lib/showcase';
import { APP_CSP, APP_INLINE_SCRIPT_HASHES, createAppServer } from '@/server/app';

const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });

describe('the app CSP', () => {
  it('locks framing and plugins on the app pages', async () => {
    expect(APP_CSP).toContain("default-src 'none'");
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).toContain("'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='");
    expect(APP_CSP).toContain("connect-src 'self' https://api-js.mixpanel.com");
    expect(APP_CSP).toContain("frame-ancestors 'self'");
    expect(APP_CSP).toContain("object-src 'none'");
    expect(APP_CSP).toContain("base-uri 'self'");
    for (const path of ['/', '/login', '/docs/human', '/account']) {
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

  /*
   * THE SHOWCASE CARDS ARE OFF-ORIGIN ON PURPOSE (lib/showcase): they are the
   * canonical instance's own captures, because a local or self-hosted install
   * does not have those ids. `img-src 'self'` therefore admits them ONLY when
   * the app IS artifactbin.dev — which is exactly how the landing page came to
   * work on the deployment and show six blocked pictures everywhere else.
   */
  it("admits the showcase origin, which the landing page's cards are addressed to", () => {
    expect(showcaseCardUrl(SHOWCASE[0]).startsWith(SHOWCASE_ORIGIN)).toBe(true);
    const imgSrc = APP_CSP.split('; ').find((d) => d.startsWith('img-src'))!;
    expect(imgSrc).toContain(SHOWCASE_ORIGIN);
  });

  it('never lands on an artifact address or a machine surface', async () => {
    for (const path of ['/a/Ab3xK9/raw', '/a/Ab3xK9/export', '/api/artifacts', '/docs/artifactbin/references/publishing.md']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).not.toBe(APP_CSP);
    }
  });
});
