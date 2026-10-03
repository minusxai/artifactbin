/**
 * The policy a document carries on its OWN origin (lib/story/styles/document-csp): what a framed
 * document may load, call and be framed by. Its origin is unique, so it needs no `sandbox`; the app
 * page goes back to its strict policy (lib/__tests__/app-page-csp).
 */
import { describe, expect, it } from 'vitest';
import { buildDocumentCsp } from '@/lib/story/styles/document-csp';

const SELF = 'https://416233784b39.pages.example.com';
const APP = 'https://app.example.com';
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

describe('buildDocumentCsp', () => {
  const csp = buildDocumentCsp({ self: SELF, app: APP, id: 'Ab3xK9' });

  it('denies by default and admits the module CDNs, blob modules and WebAssembly, never inline script or eval', () => {
    expect(directive(csp, 'default-src')).toBe("default-src 'none'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self' blob: 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net https://unpkg.com");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('connects to its own origin, this document\'s app-origin doors path-exact, and the module CDNs only', () => {
    const connect = directive(csp, 'connect-src')!.split(' ');
    expect(connect.slice(0, 2)).toEqual(['connect-src', "'self'"]);
    for (const door of ['query', 'mutate', 'events', 'fetch']) expect(connect).toContain(`${APP}/a/Ab3xK9/${door}`);
    for (const cdn of ['https://esm.sh', 'https://cdn.jsdelivr.net', 'https://unpkg.com']) expect(connect).toContain(cdn);
    // Never the app's other routes, and never any https host.
    expect(connect).not.toContain(APP);
    expect(connect).not.toContain('https:');
  });

  it('pins styles, fonts, images, media, frames and the behaviour directives', () => {
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(directive(csp, 'font-src')).toBe("font-src 'self' data: https://fonts.gstatic.com");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' https: data: blob:");
    expect(directive(csp, 'media-src')).toBe("media-src 'self' https: blob:");
    expect(directive(csp, 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://player.vimeo.com');
    expect(directive(csp, 'form-action')).toBe("form-action 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
  });

  it('is framed by the app alone, and needs no sandbox: its origin is its own', () => {
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors ${APP}`);
    expect(csp).not.toMatch(/(^|; )sandbox/);
  });

  it('appends https origins a document declares, per directive — never a connection, which goes through its /fetch door — and refuses anything else', () => {
    const extended = buildDocumentCsp({ self: SELF, app: APP, id: 'Ab3xK9', extensions: { connect: ['https://api.example.org'], script: ['https://cdn.example.org'], style: ['https://css.example.org'], img: ['https://img.example.org'] } });
    expect(directive(extended, 'connect-src')).toBe(directive(csp, 'connect-src'));
    expect(extended).not.toContain('https://api.example.org');
    expect(directive(extended, 'script-src')!.split(' ').at(-1)).toBe('https://cdn.example.org');
    expect(directive(extended, 'style-src')!.split(' ').at(-1)).toBe('https://css.example.org');
    expect(directive(extended, 'img-src')!.split(' ').at(-1)).toBe('https://img.example.org');
    for (const bad of ['http://api.example.org', 'https://api.example.org/path', "'unsafe-inline'", 'https:', '*', 'https://*.example.org', 'https://a.example.org; script-src *']) {
      expect(() => buildDocumentCsp({ self: SELF, app: APP, id: 'Ab3xK9', extensions: { connect: [bad], script: [], style: [], img: [] } }), bad).toThrow(/https origin/);
    }
  });
});
