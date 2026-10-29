/**
 * AN ARTIFACT AS AN INSTALLABLE APP, without a server: the source's own `artifactbin:pwa-*` head metas decide
 * whether it is an app and what its manifest says; the address is stable and carries no viewer state; disabled
 * means no discovery at all. The ACL and the HTTP (server/__tests__/artifact-pwa) are the route's.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ArtifactRow } from '@/lib/artifacts';
import { artifactAppIcon, artifactAppPath, artifactManifest, artifactPwaEnabled, withArtifactAppHead } from '@/lib/serving';

const head = (metas: Record<string, string>) => `<!doctype html><html><head>${Object.entries(metas).map(([name, content]) => `<meta name="artifactbin:pwa-${name}" content="${content}">`).join('')}</head><body><h1>App</h1></body></html>`;
const row = (source: string, overrides: Partial<ArtifactRow> = {}) => ({
  id: 'Ab12cd', title: 'My app', format: 'html', version: 1, meta: {}, source, document: null, ...overrides,
}) as unknown as ArtifactRow;

describe('the manifest', () => {
  it('without any declaration: disabled, named by the title, white, scoped to its stable address', () => {
    const app = row('<html><head></head><body>x</body></html>');
    expect(artifactPwaEnabled(app)).toBe(false);
    expect(artifactManifest(app)).toEqual({
      id: '/a/Ab12cd/app/', name: 'My app', short_name: 'My app', start_url: '/a/Ab12cd/app/', scope: '/a/Ab12cd/app/',
      display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff',
      icons: [
        { src: '/a/Ab12cd/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/a/Ab12cd/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    });
  });

  it('enabled: takes the declared name, short name and colours', () => {
    const app = row(head({ enabled: 'true', name: 'Tracker', 'short-name': 'Trk', 'theme-color': '#112233', 'background-color': '#AABBCC' }));
    expect(artifactPwaEnabled(app)).toBe(true);
    expect(artifactManifest(app)).toMatchObject({ name: 'Tracker', short_name: 'Trk', theme_color: '#112233', background_color: '#AABBCC' });
  });

  it('opts in only with the exact value `true`', () => {
    for (const value of ['false', 'yes', 'TRUE', '1', '']) expect(artifactPwaEnabled(row(head({ enabled: value }))), value).toBe(false);
  });

  it('ignores malformed values and falls back field by field', () => {
    const app = row(head({ enabled: 'true', name: '   ', 'short-name': 'x'.repeat(31), 'theme-color': 'red', 'background-color': '#fff' }));
    expect(artifactManifest(app)).toMatchObject({ name: 'My app', short_name: 'My app', theme_color: '#ffffff', background_color: '#ffffff' });
    expect(artifactManifest(row(head({ name: 'n'.repeat(101) }), { title: null })).name).toBe('Untitled artifact');
    expect(artifactManifest(row('<html><head></head></html>', { title: '  ' })).name).toBe('Untitled artifact');
  });

  it('reads declarations from the head only, and only for a servable HTML document', () => {
    expect(artifactPwaEnabled(row('<html><head></head><body><meta name="artifactbin:pwa-enabled" content="true"></body></html>'))).toBe(false);
    for (const format of ['markup', 'dataset', 'image', 'folder']) expect(artifactPwaEnabled(row(head({ enabled: 'true' }), { format } as Partial<ArtifactRow>)), format).toBe(false);
    // An HTML row with no source is unservable: it cannot opt in either.
    expect(artifactPwaEnabled(row('', {}))).toBe(false);
  });

  it('keeps the address free of viewer and revision state, and encodes the id', () => {
    expect(artifactAppPath('Ab12cd')).toBe('/a/Ab12cd/app/');
    expect(artifactAppPath('a/b?c')).toBe('/a/a%2Fb%3Fc/app/');
    expect(artifactManifest(row(head({ enabled: 'true' }), { version: 9 })).start_url).toBe('/a/Ab12cd/app/');
  });
});

describe('discovery in the app document', () => {
  it('is absent while disabled: the document is returned untouched', () => {
    const html = '<html><head><title>t</title></head><body></body></html>';
    expect(withArtifactAppHead(html, row(html))).toBe(html);
  });

  it('when enabled, links the manifest with credentials, the touch icon and the theme colour at the end of the head', () => {
    const source = head({ enabled: 'true', 'theme-color': '#123456' });
    const out = withArtifactAppHead('<html><head><title>t</title></head><body></body></html>', row(source));
    expect(out).toBe('<html><head><title>t</title>'
      + '<link data-mx-pwa rel="manifest" href="/a/Ab12cd/app/manifest.webmanifest" crossorigin="use-credentials">'
      + '<link data-mx-pwa rel="apple-touch-icon" href="/a/Ab12cd/app/icon-192.png">'
      + '<meta data-mx-pwa name="theme-color" content="#123456"></head><body></body></html>');
  });

  it('adds nothing to a document without a head, and adds it once', () => {
    const app = row(head({ enabled: 'true' }));
    expect(withArtifactAppHead('<p>no head</p>', app)).toBe('<p>no head</p>');
    expect(withArtifactAppHead('<head></head><head></head>', app).match(/rel="manifest"/g)).toHaveLength(1);
  });
});

describe('the generated icon', () => {
  it('is a PNG of the asked size, the same for one id and different for another', async () => {
    const app = row(head({ enabled: 'true' }));
    const [small, large, again, other] = await Promise.all([
      artifactAppIcon(app, 192), artifactAppIcon(app, 512), artifactAppIcon(app, 192), artifactAppIcon(row(head({ enabled: 'true' }), { id: 'Zz99yy' }), 192),
    ]);
    for (const [icon, size] of [[small, 192], [large, 512]] as const) {
      const meta = await sharp(icon).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', size, size]);
    }
    expect(again.equals(small)).toBe(true);
    expect(other.equals(small)).toBe(false);
  });
});
