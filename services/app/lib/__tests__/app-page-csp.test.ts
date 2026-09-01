/**
 * THE APP PAGES CARRY A CSP, AND A DOCUMENT NEVER TAKES IT. `frame-ancestors`
 * + `object-src` + `base-uri` lock the app's own pages (the share dialog,
 * /account…) against clickjacking. It must NEVER reach an artifact address:
 * `/a/<id>/raw` sets the per-row sandbox CSP itself, and a second policy on
 * that response would replace it — which is exactly how the sandbox was once
 * wiped by a catch-all rule.
 */
import { describe, expect, it } from 'vitest';
import { APP_CSP, APP_INLINE_SCRIPT_HASHES, createAppServer } from '@/server/app';

const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });

describe('the app CSP', () => {
  it('locks framing and plugins on the app pages', async () => {
    expect(APP_CSP).toContain("default-src 'none'");
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).toContain("'sha256-nsD8JKY/OL2XkCf1kqkfjHcd/GLFx3TvP19i7RMVNKE='");
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

  it('allows only the known app and development bootstrap scripts inline', () => {
    expect(APP_INLINE_SCRIPT_HASHES.split(' ')).toHaveLength(2);
    expect(APP_CSP.split('; ').find((directive) => directive.startsWith('script-src'))).not.toContain("'unsafe-inline'");
  });

  it('never lands on an artifact address or a machine surface', async () => {
    for (const path of ['/a/Ab3xK9/raw', '/a/Ab3xK9/export', '/api/artifacts', '/docs/artifact-bin/references/publishing.md']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).not.toBe(APP_CSP);
    }
  });
});
