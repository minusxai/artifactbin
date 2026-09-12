import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const PortalContainer = createContext<HTMLElement | undefined>(undefined);
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
const installedStyles = new Set<HTMLStyleElement>();
// Top-layer paint order ignores z-index. Keep selection beneath discussions,
// and navigation above both, even when a lazy runtime mounts its portal later.
const overlays = new Map<HTMLElement, number>();
function openOverlay(root: HTMLElement, priority: number) {
  overlays.set(root, priority);
  root.showPopover();
  for (const [higher, order] of [...overlays].sort((a, b) => a[1] - b[1])) {
    if (higher !== root && order > priority) { higher.hidePopover(); higher.showPopover(); }
  }
}

/** CSS boundary for first-party UI. Author content must never be mounted inside it. */
interface TrustedUiProps {
  children: ReactNode;
  /** Artifact chrome only: protects its paint order from author sibling overlays. */
  overlay?: boolean;
  layer?: 'selection' | 'discussion' | 'navigation';
}

/** Register only the app's compiled CSS, imported explicitly by its entrypoint. */
export function configureTrustedUiStyles(cssText: string): void {
  // all:initial does not reset custom properties. Reset every property used by
  // trusted CSS (including Tailwind/Radix inputs), then apply OUR defaults in
  // the next layer. Unknown author variables are harmless unless trusted CSS
  // consumes them. Never take computed properties or sheets from the document.
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

/** Owns the protected root and its portal destination; no extra document or auth origin. */
export function TrustedUi({ children, overlay = false, layer = 'discussion' }: TrustedUiProps): ReactNode {
  const [mount, setMount] = useState<{ root: HTMLElement; portal: HTMLElement } | null>(null);
  const owned = useRef<{ host: HTMLElement; style: HTMLStyleElement; root: HTMLElement; content: HTMLElement; portal: HTMLElement } | null>(null);
  const attach = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    if (!owned.current || owned.current.host !== host) {
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      const root = document.createElement('div');
      root.setAttribute('data-trusted-ui-root', '');
      const content = document.createElement('div');
      content.style.display = 'contents';
      const portal = document.createElement('div');
      portal.style.display = 'contents';
      root.append(content, portal);
      shadow.append(style, root);
      owned.current = { host, style, root, content, portal };
    }
    const { style, root, content, portal } = owned.current;
    // A normal stacking context is not a safe fallback: an author sibling
    // could paint a false label above a real action. Fail before mounting any
    // privileged controls when the requested top-layer protection is absent.
    if (overlay && typeof root.showPopover !== 'function') {
      throw new Error('Trusted UI overlay requires browser popover support');
    }
    style.textContent = trustedCss;
    if (overlay) {
      root.setAttribute('popover', 'manual');
      openOverlay(root, { selection: 0, discussion: 1, navigation: 2 }[layer]);
    } else root.removeAttribute('popover');
    installedStyles.add(style);
    setMount(previous => previous?.root === content ? previous : { root: content, portal });
    const syncTheme = () => {
      root.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      installedStyles.delete(style);
      overlays.delete(root);
      if (overlay) root.hidePopover();
      // React owns the portal children and removes them during unmount. Do
      // not clear them before React's deletion pass.
    };
  }, [overlay, layer]);
  // The host is deliberately not a security boundary against JS. Author JS
  // remains in its opaque sandbox; Shadow DOM prevents author CSS selectors
  // from reaching controls. No slots or parts expose those controls outside.
  return <div data-trusted-ui="" ref={attach} style={{ display: 'contents' }}>
    {mount && createPortal(
      <PortalContainer.Provider value={mount.portal}>{children}</PortalContainer.Provider>,
      mount.root,
    )}
  </div>;
}

/** Dialogs and popovers must inherit this destination instead of escaping into author CSS. */
export function useTrustedPortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainer);
}
