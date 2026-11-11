/**
 * THE BUILDING BLOCKS ANOTHER SHELL LOADS, AT PINNED ADDRESSES. A host page (not an Artifactbin page: another web shell
 * on a trusted origin, skills/artifactbin/references/host-pages.md) loads the public components, the design-system
 * stylesheets and, on the app's own origin, the document host module. The flat addresses pages use
 * (/af/components/<name>.js, /af/styles.css, /af/host.js) follow every deploy; these never change:
 *
 *   /af/manifest.json                   names → this build's pinned URLs, sha384 integrity for every file, the design
 *                                       systems and the theme contract (no-cache + ETag: it moves with each deploy)
 *   /af/v1/components/<digest>/<file>   one build's public components and the chunks they import, as one retained
 *                                       bundle (sha256 of its canonical JSON): relative chunk imports resolve inside it
 *   /af/v1/styles/<sha256>.css          the whole platform stylesheet, or one design system's
 *   /af/v1/host/<sha256>.js             the document host module (lib/html-reader/host-shell)
 *   /af/fonts/<name>.woff2              already immutable: a font name never changes its bytes
 *
 * Kept by the runtime's retention (lib/html-runtime createSourceRetention, a namespace per kind): an address
 * the manifest names is durable before the manifest is answered, and keeps answering its exact bytes after later
 * deploys. Public code and CSS only: no page, viewer or credential reaches any of these bytes, and every answer is
 * `Access-Control-Allow-Origin: *` without a resource policy, as the flat addresses are.
 */
import { createHash } from 'node:crypto';
import { publicComponentFiles } from '@/lib/libraries/server';
import { hostedComponentEntries } from '@/lib/libraries';
import { buildHtmlAssets, createSourceRetention, retainedPublicAssets, type SourceRetention } from '@/lib/html-runtime/server';
import { HTML_SYSTEM_NAMES, HTML_SYSTEM_LABELS, PLATFORM_FONTS_PATH, THEME_ATTRIBUTES, THEME_TOKENS, OPTIONAL_THEME_TOKENS, htmlSystemsCss } from '@/lib/html-systems';
import { HTML_SYSTEM_MODES } from '@/lib/validation/html-system-modes';
import { matchingTag, publicRevalidatedResponse } from '@/lib/http';
import { NO_STORE, PUBLIC_IMMUTABLE } from './cache-control';

const sha256 = (source: string) => createHash('sha256').update(source).digest('hex');
const integrity = (source: string | Buffer) => `sha384-${createHash('sha384').update(source).digest('base64')}`;
/** One namespace per kind, so a digest is only ever answered as the kind it was stored as. */
const stores = {
  components: retainedPublicAssets('components', 'application/json; charset=utf-8'),
  styles: retainedPublicAssets('styles', 'text/css; charset=utf-8'),
  host: retainedPublicAssets('host', 'text/javascript; charset=utf-8'),
};
type Kind = keyof typeof stores;

interface Blocks {
  retention: Record<Kind, SourceRetention>;
  /** The component bundle's digest and files (file → text). */
  bundle: { digest: string; files: Record<string, string> } | null;
  manifest: string;
}

/** The canonical bundle text: sorted file names, so equal files are equal bytes (and one digest). */
const bundleText = (files: Map<string, Buffer>) =>
  JSON.stringify({ files: Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, body]) => [name, body.toString('utf8')])) });

let current: { key: string; blocks: Promise<Blocks> } | undefined;
async function blocks(): Promise<Blocks> {
  const [assets, files] = await Promise.all([buildHtmlAssets(), publicComponentFiles()]);
  // A development rebuild of the components changes their bytes: the key follows them, so the manifest does too.
  const text = files ? bundleText(files) : null;
  const key = sha256(`${text ?? ''}\n${assets.host ?? ''}`);
  if (current?.key === key) return current.blocks;
  const pending = (async (): Promise<Blocks> => {
    const sheets = { all: assets.systems ?? htmlSystemsCss(), ...Object.fromEntries(HTML_SYSTEM_NAMES.map(name => [name, htmlSystemsCss([name])])) } as Record<string, string>;
    const retention = {
      components: createSourceRetention(text ? [text] : [], stores.components, sha256),
      styles: createSourceRetention(Object.values(sheets), stores.styles, sha256),
      host: createSourceRetention(assets.host ? [assets.host] : [], stores.host, sha256),
    };
    const bundle = text ? { digest: sha256(text), files: (JSON.parse(text) as { files: Record<string, string> }).files } : null;
    const hashes: Record<string, string> = {};
    const styleUrl = (css: string) => { const url = `/af/v1/styles/${sha256(css)}.css`; hashes[url] = integrity(css); return url; };
    const components: Record<string, string> = {};
    if (bundle) for (const [file, body] of Object.entries(bundle.files)) {
      const url = `/af/v1/components/${bundle.digest}/${file}`;
      hashes[url] = integrity(body);
      const name = file.slice(0, -3);
      if (hostedComponentEntries().includes(name)) components[name] = url;
    }
    const host = assets.host ? `/af/v1/host/${sha256(assets.host)}.js` : null;
    if (host) hashes[host] = integrity(assets.host!);
    const manifest = JSON.stringify({
      version: 1,
      components,
      styles: styleUrl(sheets.all!),
      designSystems: Object.fromEntries(HTML_SYSTEM_NAMES.map(name => [name, { label: HTML_SYSTEM_LABELS[name], defaultMode: HTML_SYSTEM_MODES[name], styles: styleUrl(sheets[name]!) }])),
      fonts: PLATFORM_FONTS_PATH,
      ...(host ? { host } : {}),
      theme: { attributes: THEME_ATTRIBUTES, tokens: THEME_TOKENS, optionalTokens: OPTIONAL_THEME_TOKENS },
      integrity: hashes,
    });
    // Nothing is named before it is durable.
    await Promise.all(Object.values(retention).map(kind => kind.expose()));
    return { retention, bundle, manifest };
  })();
  pending.catch(() => { if (current?.blocks === pending) current = undefined; });
  current = { key, blocks: pending };
  return pending;
}

/** GET /af/manifest.json: this build's pinned addresses. */
export async function hostedBlocksManifestResponse(request: Request): Promise<Response> {
  return publicRevalidatedResponse(request, (await blocks()).manifest, 'application/json; charset=utf-8');
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': NO_STORE } });
function immutable(request: Request, body: string, type: string, digest: string): Response {
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': PUBLIC_IMMUTABLE, etag: `"${digest}"`, 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
  if (matchingTag(request.headers.get('if-none-match'), headers.etag!)) return new Response(null, { status: 304, headers });
  headers['content-length'] = String(Buffer.byteLength(body));
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

/** Older bundles read back from the store, verified, parsed once (a host page asks for many files of one). */
const parsed = new Map<string, Record<string, string>>();
async function bundleFiles(digest: string): Promise<Record<string, string> | null> {
  const built = await blocks();
  if (built.bundle?.digest === digest) return built.bundle.files;
  const cached = parsed.get(digest);
  if (cached) return cached;
  const text = await built.retention.components.read(digest);
  if (text === null) return null;
  let files: unknown;
  try { files = (JSON.parse(text) as { files?: unknown }).files; } catch { return null; }
  if (!files || typeof files !== 'object') return null;
  if (parsed.size >= 4) parsed.delete(parsed.keys().next().value!);
  parsed.set(digest, files as Record<string, string>);
  return files as Record<string, string>;
}

/** GET /af/v1/components/<digest>/<file>: a file of one retained component bundle. */
export async function pinnedComponentResponse(request: Request, digest: string, file: string): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-z][a-z0-9-]*\.js$/.test(file)) return notFound();
  const files = await bundleFiles(digest);
  const body = files && Object.hasOwn(files, file) ? files[file] : undefined;
  return typeof body === 'string' ? immutable(request, body, 'text/javascript; charset=utf-8', `${digest}/${file}`) : notFound();
}

/** A retained stylesheet or host module by its own digest: `<sha256>.css` or `<sha256>.js`. */
async function pinnedSource(request: Request, file: string, kind: 'styles' | 'host'): Promise<Response> {
  const digest = (kind === 'styles' ? /^([a-f0-9]{64})\.css$/ : /^([a-f0-9]{64})\.js$/).exec(file)?.[1];
  if (!digest) return notFound();
  const source = await (await blocks()).retention[kind].read(digest);
  if (source === null) return notFound();
  return immutable(request, source, kind === 'styles' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', digest);
}
export const pinnedStylesResponse = (request: Request, file: string) => pinnedSource(request, file, 'styles');
export const pinnedHostResponse = (request: Request, file: string) => pinnedSource(request, file, 'host');
