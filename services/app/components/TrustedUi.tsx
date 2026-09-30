import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { configureTrustedUiStyles, configureTrustedUiFromShell, currentTrustedCss, installedStyles, openOverlay, overlays } from '@/lib/trusted-ui-styles';

const PortalContainer = createContext<HTMLElement | undefined>(undefined);

export { configureTrustedUiStyles, configureTrustedUiFromShell };

/** CSS boundary for first-party UI. Author content must never be mounted inside it. */
interface TrustedUiProps {
  children: ReactNode;
  /** Artifact chrome only: protects its paint order from author sibling overlays. */
  overlay?: boolean;
  /** `modal`: a question that blocks everything else, above even a composer in the foreground. */
  layer?: 'selection' | 'discussion' | 'navigation' | 'modal';
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
    style.textContent = currentTrustedCss();
    if (overlay) {
      root.setAttribute('popover', 'manual');
      openOverlay(root, { selection: 0, discussion: 1, navigation: 2, modal: 4 }[layer]);
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

/** Temporarily place active composition above navigation without remounting its draft. */
export function useForegroundComposer(active: boolean): void {
  const container = useTrustedPortalContainer();
  useEffect(() => {
    const root = container?.parentElement;
    const previous = root ? overlays.get(root) : undefined;
    if (!active || !root || previous === undefined) return;
    const focused = (root.getRootNode() as ShadowRoot).activeElement;
    root.hidePopover();
    openOverlay(root, 3);
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    return () => {
      if (!overlays.has(root)) return;
      root.hidePopover();
      openOverlay(root, previous);
    };
  }, [active, container]);
}
