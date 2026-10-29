/**
 * THE HOME PAGE OF A CUSTOM DOMAIN, as a pure render: what `renderDomainHome` draws from the profile answer it is
 * handed, which stylesheets `linkedStylesheets` carries over from the app shell, and the one policy the page ships
 * under. The route (server/custom-host) only adds the HTTP; server/__tests__/custom-domain-host keeps that boundary.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOMAIN_FOOTER_TEXT } from '@artifactbin/contracts/domain-footer';
import { DOMAIN_HOME_CSP, linkedStylesheets, renderDomainHome, type ProfileListingData } from '@/lib/custom-domains';
import { THEME_BOOTSTRAP_HASH, THEME_BOOTSTRAP_SCRIPT } from '@/lib/page-styles';

const NOW = new Date().toISOString();
const file = (id: string, format: string, title: string | null, version = 1) => ({ id, format, title, updated_at: NOW, version });
const home = (overrides: Partial<Parameters<typeof renderDomainHome>[0]> = {}) => renderDomainHome({
  hostname: 'blog.example.org',
  owner: { username: 'vivek', name: 'Vivek R' },
  profile: null,
  footerHref: 'https://app.example.test/@vivek',
  stylesheets: ['/shell.css'],
  ...overrides,
});

describe('the page around the listing', () => {
  it('names the owner, then the handle, then the hostname, and is canonical at the host root', () => {
    expect(home()).toContain('<title>Vivek R</title>');
    expect(home({ owner: { username: 'vivek', name: '   ' } })).toContain('<title>@vivek</title>');
    const anonymous = home({ owner: { username: null, name: null } });
    expect(anonymous).toContain('<title>blog.example.org</title>');
    expect(anonymous).toContain('<meta name="description" content="Writing by blog.example.org.">');
    expect(home()).toContain('<link rel="canonical" href="https://blog.example.org/">');
    expect(home()).toContain('<meta property="og:url" content="https://blog.example.org/">');
  });

  it('escapes what the owner controls: their name, the footer link and stylesheet addresses', () => {
    const html = home({ owner: { username: 'x', name: '<script>alert(1)</script>' }, footerHref: 'https://app.example.test/@x?"><b>', stylesheets: ['/a.css?"x'] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('"><b>');
    expect(html).toContain('<link rel="stylesheet" href="/a.css?&quot;x">');
  });

  it('runs exactly one script, the theme stamp, and the policy admits it by its own hash and nothing else', () => {
    const html = home();
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![0]).toBe(`<script>${THEME_BOOTSTRAP_SCRIPT}</script>`);
    expect(THEME_BOOTSTRAP_HASH).toBe(`'sha256-${createHash('sha256').update(THEME_BOOTSTRAP_SCRIPT).digest('base64')}'`);
    expect(DOMAIN_HOME_CSP).toContain(`script-src ${THEME_BOOTSTRAP_HASH};`);
    for (const directive of ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "img-src 'self' data:"]) expect(DOMAIN_HOME_CSP).toContain(directive);
    expect(DOMAIN_HOME_CSP).not.toMatch(/script-src[^;]*'(?:self|unsafe-inline)'/);
  });

  it('links the stylesheets it is given, in their order, before the body; and ends with the footer', () => {
    const html = home({ stylesheets: ['/one.css', '/two.css'] });
    const head = html.split('</head>')[0]!;
    expect(head.indexOf('href="/one.css"')).toBeGreaterThan(head.indexOf(THEME_BOOTSTRAP_SCRIPT));
    expect(head.indexOf('href="/one.css"')).toBeLessThan(head.indexOf('href="/two.css"'));
    expect(html).toContain(`${DOMAIN_FOOTER_TEXT} <a href="https://app.example.test/@vivek"`);
    expect(html.endsWith('</footer></body></html>')).toBe(true);
  });
});

describe('the listing', () => {
  it('says nothing is here without a profile, and for a profile with no files', () => {
    expect(home()).toContain('nothing here yet');
    const empty = home({ profile: { handle: 'vivek', files: [] } });
    expect(empty).toContain('nothing here yet');
    expect(empty).toContain('0 public artifacts');
    expect(empty).not.toContain('aria-label="Artifact grid"');
    // A folder's page is not served on the domain: an owner with only folders has nothing here.
    expect(home({ profile: { handle: 'vivek', files: [file('dir222', 'folder', 'Notes')] } })).toContain('nothing here yet');
  });

  it('lists only documents: folders are dropped, other formats are neither counted nor drawn', () => {
    const profile: ProfileListingData = {
      handle: 'vivek',
      owner: { id: 'usr_1', image: null },
      files: [file('doc111', 'html', 'Hello World', 3), file('dir222', 'folder', 'Notes'), file('img333', 'image', 'Photo'), file('dat444', 'dataset', 'Rows')],
    };
    const html = home({ profile });
    expect(html).toContain('1 public artifact<');
    expect(html).toContain('href="/doc111-hello-world"');
    expect(html).toContain('aria-label="Open Hello World"');
    expect(html).toContain('/a/doc111/export?format=jpg&amp;mode=card&amp;v=3&amp;r=');
    for (const id of ['dir222', 'img333', 'dat444']) expect(html).not.toContain(id);
  });

  it('counts plural documents, escapes titles, and names an untitled one by its id', () => {
    const html = home({ profile: { handle: 'vivek', files: [file('doc111', 'html', '<b>bold</b>'), file('doc222', 'html', null)] } });
    expect(html).toContain('2 public artifacts');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('href="/doc222"');
    expect(html).toContain('aria-label="Open doc222"');
    expect(html).toContain('>Untitled</a>');
  });

  it('draws the owner\'s picture over their initial when there is one', () => {
    const withImage = home({ profile: { handle: 'vivek', owner: { id: 'usr_1', image: '/api/avatars/usr_1?v=2' }, files: [] } });
    expect(withImage).toContain('<img src="/api/avatars/usr_1?v=2" alt=""');
    expect(withImage).toContain('data-face-initial');
    const noOwner = home({ profile: { handle: 'vivek', files: [] } });
    expect(noOwner).not.toContain('data-face-initial');
  });
});

describe('linkedStylesheets', () => {
  it('reads the head\'s same-origin stylesheet links in order, and nothing else', () => {
    const shell = '<!doctype html><html><head>'
      + '<link rel="stylesheet" href="/first.css">'
      + '<link rel="preload" href="/font.woff2" as="font">'
      + "<link href='/second.css' rel='stylesheet'>"
      + '<link rel=stylesheet href="/third.css">'
      + '<link rel="stylesheet" href="https://cdn.example.test/x.css">'
      + '<link rel="stylesheet" href="//cdn.example.test/y.css">'
      + '<link rel="alternate stylesheet" href="/alt.css">'
      + '<link rel="stylesheet">'
      + '</head><body><link rel="stylesheet" href="/body.css"></body></html>';
    expect(linkedStylesheets(shell)).toEqual(['/first.css', '/second.css', '/third.css']);
  });

  it('answers nothing for a shell without links', () => {
    expect(linkedStylesheets('<html><head><title>x</title></head></html>')).toEqual([]);
    expect(linkedStylesheets('')).toEqual([]);
  });
});
