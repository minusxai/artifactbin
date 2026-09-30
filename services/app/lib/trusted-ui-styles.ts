/**
 * THE TRUSTED UI BOUNDARY, framework-free: the app's own stylesheet re-scoped into a shadow root, and
 * the top-layer paint order of the protected overlays. components/TrustedUi (React) and
 * solid/components/TrustedUi (Solid) both draw their shadow roots from this one sheet.
 */
const ROOT = '[data-trusted-ui-root]';
const BOUNDARY_CSS = `
:host::before, :host::after { content: none !important; display: none !important; }
${ROOT}[popover] {
  position: fixed !important; inset: 0 !important; margin: 0 !important;
  width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important;
  padding: 0 !important; border: 0 !important; overflow: visible !important;
  background: transparent !important; pointer-events: none !important;
}
${ROOT}[popover]:popover-open { display: block !important; }
${ROOT}[popover] > div { pointer-events: auto; }
`;
let trustedCss = BOUNDARY_CSS;
/** The trusted sheet as last configured. */
export const currentTrustedCss = (): string => trustedCss;
export const installedStyles = new Set<HTMLStyleElement>();
// Top-layer paint order ignores z-index. Keep selection beneath discussions,
// and navigation above both, even when a lazy runtime mounts its portal later.
export const overlays = new Map<HTMLElement, number>();
export function openOverlay(root: HTMLElement, priority: number) {
  overlays.set(root, priority);
  root.showPopover();
  for (const [higher, order] of [...overlays].sort((a, b) => a[1] - b[1])) {
    if (higher !== root && order > priority) { higher.hidePopover(); higher.showPopover(); }
  }
}

/** Register only the app's compiled CSS, handed over explicitly by its entrypoint. */
export function configureTrustedUiStyles(cssText: string): void {
  // all:initial does not reset custom properties. Reset every property used by
  // trusted CSS (including Tailwind/Radix inputs), then apply OUR defaults in
  // the next layer. Unknown author variables are harmless unless trusted CSS
  // consumes them. Never take computed properties from the document, and no
  // sheet but the app's own (configureTrustedUiFromShell).
  const properties = [...new Set(cssText.match(/--[a-zA-Z_][\w-]*/g) ?? [])];
  const reset = properties.map(name => `${name}: initial;`).join('');
  // These selectors refer to the app document in its normal stylesheet; in a
  // shadow tree they must target the protected inner root, not the host (whose
  // properties author CSS can override). Only explicit trusted compiled CSS
  // enters here, never artifact stylesheets.
  const scoped = cssText.replace(/:root\b|:host\b/g, ROOT)
    .replace(/(^|[},\s])(?:html|body)(?=[\s,{])/g, `$1${ROOT}`);
  trustedCss = `@layer trusted-ui-reset { ${ROOT} { all: initial; ${reset} } }\n${scoped}\n${ROOT} { display: contents; }\n${BOUNDARY_CSS}`;
  for (const style of installedStyles) style.textContent = trustedCss;
}

/**
 * Configure the trusted sheet from the app's OWN stylesheet, where the HTML
 * shell already loaded it — so the Tailwind sheet ships once, as the render-
 * blocking CSS every page needs anyway, instead of a second copy inlined in the
 * SPA's JavaScript (lib/__tests__/reader-bundle-hygiene).
 *
 * Exactly which sheets: the same-origin `<link rel="stylesheet">` elements in
 * the shell's `<head>` (web/index.html → the built `/assets/index-*.css`, or
 * `/shell.css` under the dev server), found ONCE, by the entrypoint, before any
 * React tree mounts. Never a `<style>` element and never anything later:
 * author CSS reaches the document only as `<style>` (a server-rendered
 * document's sheet in <body>, the inline runtime's own), so it can never be
 * taken for the app's.
 *
 * The TEXT is the file's own bytes, re-read from the HTTP cache the link just
 * filled (a same-origin fetch of an immutable, content-addressed asset). Not
 * the parsed rules: CSSOM serialization is lossy — a shorthand carrying a
 * `var()` beside a longhand that overrides part of it (`border: 1px solid
 * var(--edge); border-bottom: 0`) serializes with EMPTY longhands, and parsing
 * that back drops the border. Until the bytes land (a few milliseconds, before
 * the first route chunk has mounted in practice) the parsed rules stand in, so
 * trusted UI is never unstyled and never waits; the exact text then replaces
 * them in every mounted root.
 */
export function configureTrustedUiFromShell(doc: Document = document): void {
  const origin = new URL(doc.baseURI).origin;
  const links = [...doc.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
    .filter(link => { try { return new URL(link.href, doc.baseURI).origin === origin; } catch { return false; } });
  const exact = new Map<HTMLLinkElement, string>();
  const parsed = (link: HTMLLinkElement): string => {
    try { return link.sheet ? Array.from(link.sheet.cssRules, rule => rule.cssText).join('\n') : ''; }
    catch { return ''; }
  };
  const apply = () => configureTrustedUiStyles(links.map(link => exact.get(link) ?? parsed(link)).join('\n'));
  apply();
  for (const link of links) {
    // A sheet the parser has not finished yet stands in once it has loaded.
    if (!link.sheet) link.addEventListener('load', () => { if (!exact.has(link)) apply(); }, { once: true });
    // Asked for AS CSS, and only CSS accepted: the dev server answers a bare
    // request for a .css path with its JS module wrapper instead.
    void fetch(link.href, { credentials: 'same-origin', headers: { accept: 'text/css' } })
      .then(response => response.ok && /\btext\/css\b/.test(response.headers.get('content-type') ?? '') ? response.text() : Promise.reject(new Error(String(response.status))))
      .then(text => { exact.set(link, text); apply(); })
      .catch(() => { /* the parsed rules keep standing in */ });
  }
}

