/**
 * A TRUSTED UI ROOT without a framework — the shape solid/components/TrustedUi draws: a `[data-trusted-ui]`
 * host whose open shadow root holds the app's own sheet (lib/trusted-ui-styles) and
 * `[data-trusted-ui-root]` with exactly two children, the content and then the PORTAL destination
 * (what lib/islands/trusted-portal hands popovers, tooltips and kit overlays). Author CSS selectors
 * cannot reach what is mounted inside. As an overlay the root is a manual popover in the top layer,
 * ordered by `layer` (selection < discussion < navigation < modal).
 */
import { currentTrustedCss, installedStyles, openOverlay, overlays } from '@/lib/serving/trusted-ui-styles';
import { TRUSTED_LAYER_ATTR } from '@/lib/islands/trusted-portal';

export type TrustedLayer = 'selection' | 'discussion' | 'navigation' | 'modal';
const PRIORITY: Record<TrustedLayer, number> = { selection: 0, discussion: 1, navigation: 2, modal: 4 };

export interface TrustedOverlayHost {
  host: HTMLElement;
  content: HTMLElement;
  portal: HTMLElement;
  /** Enter the top layer (an overlay whose host was not yet connected when it was made). */
  show(): void;
  dispose(): void;
}

export function createTrustedOverlayHost(options: { doc?: Document; parent?: HTMLElement; overlay?: boolean; layer?: TrustedLayer } = {}): TrustedOverlayHost {
  const doc = options.doc ?? document;
  const host = doc.createElement('div');
  host.setAttribute('data-trusted-ui', '');
  // Which layer this root is (lib/islands/trusted-portal finds the "navigation" one by it, wherever it sits in the page).
  if (options.layer) host.setAttribute(TRUSTED_LAYER_ATTR, options.layer);
  host.style.display = 'contents';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = currentTrustedCss();
  installedStyles.add(style);
  const root = doc.createElement('div');
  root.setAttribute('data-trusted-ui-root', '');
  const content = doc.createElement('div');
  content.style.display = 'contents';
  const portal = doc.createElement('div');
  portal.style.display = 'contents';
  root.append(content, portal);
  shadow.append(style, root);
  (options.parent ?? doc.body).append(host);
  const syncTheme = () => root.setAttribute('data-theme', doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  syncTheme();
  const observer = new MutationObserver(syncTheme);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const overlay = !!options.overlay && typeof root.showPopover === 'function';
  if (overlay) root.setAttribute('popover', 'manual');
  const show = () => {
    if (!overlay || !root.isConnected || overlays.has(root)) return;
    try { openOverlay(root, PRIORITY[options.layer ?? 'discussion']); } catch { /* a disconnected root cannot open */ }
  };
  show();
  return {
    host, content, portal, show,
    dispose() {
      observer.disconnect();
      installedStyles.delete(style);
      overlays.delete(root);
      if (overlay) { try { root.hidePopover(); } catch { /* already closed */ } }
      host.remove();
    },
  };
}
