/** lib/page-styles through its index: every exported value, with the edges each one decides. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { APP_SHELL_FONT_PRELOADS, THEME_BOOTSTRAP_HASH, THEME_BOOTSTRAP_SCRIPT, appendCspExtensions, buildDocumentCsp, fontPreloadTags, markupCsp } from '..';

const NONE = { connect: [], script: [], style: [], img: [], frame: [], media: [] };
const directive = (policy: string, name: string): string => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildDocumentCsp', () => {
  const base = { self: 'https://ab12.pages.example', app: 'https://app.example/some/path', id: 'doc1' };

  it('denies by default, admits the document\'s own app doors path-exact and only the app as framer', () => {
    const policy = buildDocumentCsp(base);
    expect(policy.startsWith("default-src 'none'; ")).toBe(true);
    expect(policy.endsWith('frame-ancestors https://app.example')).toBe(true);
    const connect = directive(policy, 'connect-src');
    for (const door of ['query', 'mutate', 'events', 'fetch']) expect(connect).toContain(`https://app.example/a/doc1/${door}`);
    expect(connect).not.toContain('/a/doc1/assets');
    expect(connect).not.toContain('/a/doc1/css');
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'frame-src')).toContain('https://www.youtube.com');
  });

  it('admits a configured asset origin and its assets door', () => {
    const policy = buildDocumentCsp({ ...base, assetOrigin: 'https://cdn.example/bucket' });
    expect(directive(policy, 'script-src')).toContain('https://cdn.example');
    expect(directive(policy, 'connect-src')).toContain('https://app.example/a/doc1/assets');
  });

  it('appends declared hosts per directive, except connect, which the /fetch door serves', () => {
    const policy = buildDocumentCsp({ ...base, extensions: { ...NONE, connect: ['https://api.example'], script: ['https://js.example'], frame: ['https://*.frames.example'] } });
    expect(directive(policy, 'script-src')).toContain('https://js.example');
    expect(directive(policy, 'frame-src')).toContain('https://*.frames.example');
    expect(policy).not.toContain('https://api.example');
  });

  it('throws rather than build a policy from a malformed origin or a non-canonical host', () => {
    expect(() => buildDocumentCsp({ ...base, self: 'not a url' })).toThrow();
    expect(() => buildDocumentCsp({ ...base, extensions: { ...NONE, img: ['http://plain.example'] } })).toThrow(/not an https origin/);
    expect(() => buildDocumentCsp({ ...base, extensions: { ...NONE, style: ['https://trailing.example/'] } })).toThrow(/not an https origin/);
  });
});

describe('markupCsp', () => {
  it('is the sandboxed /raw policy: inline script, this document\'s doors under a trimmed origin', () => {
    const policy = markupCsp('https://app.example//', 'doc1');
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'");
    const connect = directive(policy, 'connect-src');
    expect(connect).toContain('https://app.example/a/doc1/query');
    expect(connect).toContain('https://app.example/a/doc1/events/frame');
    expect(connect).not.toContain('/a/doc1/viewer');
    expect(policy).toMatch(/; sandbox allow-scripts [^;]*$/);
  });

  it('adds a bare asset origin to the byte directives and refuses one with a path', () => {
    const policy = markupCsp('https://app.example', 'doc1', 'https://cdn.example');
    expect(directive(policy, 'img-src')).toContain('https://cdn.example');
    expect(directive(policy, 'style-src')).not.toContain('https://cdn.example');
    expect(directive(policy, 'connect-src')).toContain('https://cdn.example https://app.example/a/doc1/assets');
    expect(() => markupCsp('https://app.example', 'doc1', 'https://cdn.example/x')).toThrow('Invalid asset origin');
  });
});

describe('appendCspExtensions', () => {
  const policy = "default-src 'none'; style-src 'self'; font-src 'self'; frame-src 'none'";

  it('is the identity on an empty set', () => {
    expect(appendCspExtensions(policy)).toBe(policy);
    expect(appendCspExtensions(policy, NONE)).toBe(policy);
  });

  it('extends style and font from csp-style, replaces a lone none, and skips what the policy already has', () => {
    const out = appendCspExtensions(`${policy}; img-src https://img.example`, { ...NONE, style: ['https://css.example'], frame: ['https://f.example'], img: ['https://img.example'] });
    expect(out).toBe("default-src 'none'; style-src 'self' https://css.example; font-src 'self' https://css.example; frame-src https://f.example; img-src https://img.example");
  });

  it('never adds a directive the policy does not carry', () => {
    expect(appendCspExtensions(policy, { ...NONE, media: ['https://m.example'] })).toBe(policy);
  });
});

describe('fontPreloadTags', () => {
  it('writes one crossorigin preload per distinct url, escaped, high priority on request', () => {
    expect(fontPreloadTags([])).toBe('');
    const tags = fontPreloadTags(['/fonts/a.woff2', '/fonts/a.woff2', '/fonts/b"&.woff2']);
    expect(tags.match(/<link /g)).toHaveLength(2);
    expect(tags).toContain('href="/fonts/b&quot;&amp;.woff2"');
    expect(tags).toContain('as="font" type="font/woff2" crossorigin>');
    expect(tags).not.toContain('fetchpriority');
    expect(fontPreloadTags(['/fonts/a.woff2'], true)).toContain('fetchpriority="high" rel="preload"');
  });
});

describe('the theme bootstrap', () => {
  it('is pinned by the hash the CSP admits it with', () => {
    expect(THEME_BOOTSTRAP_HASH).toBe(`'sha256-${createHash('sha256').update(THEME_BOOTSTRAP_SCRIPT).digest('base64')}'`);
    expect(THEME_BOOTSTRAP_SCRIPT).toMatch(/^try\{.*\}catch\(e\)\{\}$/);
  });
});

describe('APP_SHELL_FONT_PRELOADS', () => {
  it('names distinct hashed woff2 files of the shell face', () => {
    expect(APP_SHELL_FONT_PRELOADS.length).toBeGreaterThan(0);
    expect(new Set(APP_SHELL_FONT_PRELOADS).size).toBe(APP_SHELL_FONT_PRELOADS.length);
    for (const url of APP_SHELL_FONT_PRELOADS) expect(url).toMatch(/^\/fonts\/jetbrains-mono[\w-]*\.[a-f0-9]{8}\.woff2$/);
  });
});
