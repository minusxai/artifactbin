import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const PortalContainer = createContext<HTMLElement | undefined>(undefined);
const ROOT = '[data-trusted-ui-root]';
let trustedCss = '';
const installedStyles = new Set<HTMLStyleElement>();

/** CSS boundary for first-party UI. Author content must never be mounted inside it. */
export interface TrustedUiProps {
  children: ReactNode;
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
  trustedCss = `@layer trusted-ui-reset { ${ROOT} { all: initial; ${reset} } }\n${scoped}\n${ROOT} { display: contents; }`;
  for (const style of installedStyles) style.textContent = trustedCss;
}

/** Owns the protected root and its portal destination; no extra document or auth origin. */
export function TrustedUi({ children }: TrustedUiProps): ReactNode {
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
    style.textContent = trustedCss;
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
      // React owns the portal children and removes them during unmount. Do
      // not clear them before React's deletion pass.
    };
  }, []);
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
