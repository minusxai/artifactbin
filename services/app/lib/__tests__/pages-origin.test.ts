/** Every document on its own origin: the APP__PAGES_HOST setting and the hostname ⇄ id mapping. */
import { describe, expect, it } from 'vitest';
import { parsePagesHost, requirePagesHost } from '@/lib/platform/config';
import { idFromPagesHost, idFromPagesLabel, idFromPagesOrigin, isPagesApexHost, pagesApexOrigin, pagesLabel, pagesOriginFor, pagesSiteFor } from '@/lib/serving/pages-origin';

const prod = pagesSiteFor('pages.example.com', 'https://app.example.com')!;
const dev = pagesSiteFor('lvh.me', 'http://app.lvh.me:11001')!;

describe('APP__PAGES_HOST', () => {
  it('reads unset or blank as missing (the boot refuses it: requirePagesHost), and a bare lowercase hostname when set', () => {
    expect(parsePagesHost(undefined)).toBeNull();
    expect(parsePagesHost('  ')).toBeNull();
    expect(parsePagesHost(' Pages.Example.COM. ')).toBe('pages.example.com');
    expect(requirePagesHost()).toBe('lvh.me');
  });
  it('refuses a scheme, a port, a path or a wildcard rather than guessing', () => {
    for (const bad of ['https://pages.example.com', 'pages.example.com:443', 'pages.example.com/x', '*.pages.example.com', 'pages_example.com']) {
      expect(() => parsePagesHost(bad), bad).toThrow(/APP__PAGES_HOST/);
    }
  });
});

describe('the hostname ⇄ id mapping', () => {
  it('rides a case-sensitive id as lowercase hex, so two ids that differ only in case get two origins', () => {
    expect(pagesLabel('Ab3xK9')).toBe('416233784b39');
    expect(pagesOriginFor('Ab3xK9', prod)).toBe('https://416233784b39.pages.example.com');
    expect(pagesOriginFor('ab3xk9', prod)).not.toBe(pagesOriginFor('Ab3xK9', prod));
    expect(idFromPagesHost('416233784b39.pages.example.com', prod)).toBe('Ab3xK9');
  });
  it('takes the public URL\'s scheme and port, so development appends its port', () => {
    expect(pagesOriginFor('Ab3xK9', dev)).toBe('http://416233784b39.lvh.me:11001');
    expect(pagesApexOrigin(dev)).toBe('http://lvh.me:11001');
    expect(pagesApexOrigin(prod)).toBe('https://pages.example.com');
  });
  it('round-trips every id shape and survives the browser lowercasing the host', () => {
    for (const id of ['Ab3xK9', 'zzzzzz', 'A1B2C3D4E5F6']) {
      const host = new URL(pagesOriginFor(id, prod)).host;
      expect(idFromPagesHost(host.toUpperCase(), prod), id).toBe(id);
    }
  });
  it('matches by hostname, whatever port the process saw', () => {
    expect(idFromPagesHost('416233784b39.lvh.me:11001', dev)).toBe('Ab3xK9');
    expect(idFromPagesHost('416233784b39.lvh.me:80', dev)).toBe('Ab3xK9');
  });
  it('names no document for the apex, the app, a nested label, a stranger or a non-id label', () => {
    for (const host of ['pages.example.com', 'app.example.com', 'x.416233784b39.pages.example.com', '416233784b39.pages.example.com.evil.test', 'evil416233784b39.pages.example.com', '41623.pages.example.com', '2f2f2f2f2f2f.pages.example.com']) {
      expect(idFromPagesHost(host, prod), host).toBeNull();
    }
    expect(idFromPagesLabel('app')).toBeNull();
    expect(idFromPagesHost('416233784b39.pages.example.com', null)).toBeNull();
    expect(isPagesApexHost('pages.example.com', prod)).toBe(true);
    expect(isPagesApexHost('lvh.me:11001', dev)).toBe(true);
    expect(isPagesApexHost('416233784b39.pages.example.com', prod)).toBe(false);
  });
  it('reads an Origin only at the pages scheme, and never `null` or garbage', () => {
    expect(idFromPagesOrigin('https://416233784b39.pages.example.com', prod)).toBe('Ab3xK9');
    expect(idFromPagesOrigin('http://416233784b39.pages.example.com', prod)).toBeNull();
    expect(idFromPagesOrigin('null', prod)).toBeNull();
    expect(idFromPagesOrigin('https://app.example.com', prod)).toBeNull();
    expect(idFromPagesOrigin(undefined, prod)).toBeNull();
  });
});
