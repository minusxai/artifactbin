/* @jsxImportSource solid-js */
/**
 * The CSS boundary for first-party UI on a page that also shows
 * author content (the document page). Children render into a shadow root carrying the app's own
 * sheet, so the document's stylesheet (its preflight, its utilities, its author rules) cannot restyle
 * them; as an overlay the root sits in the top layer so an author sibling cannot paint over it. Its
 * portal is where solid/components/Popover, Tooltip and MobileSheet mount (lib/islands/trusted-portal).
 */
import { createEffect, onCleanup, onMount, type Accessor, type JSX } from 'solid-js';
import { openOverlay, overlays } from '@/lib/serving/trusted-ui-styles';
import { Portal } from 'solid-js/web';
import { createTrustedOverlayHost, type TrustedLayer } from '@/lib/story-runtime/trusted-overlay-host';

export function TrustedUi(props: { overlay?: boolean; layer?: TrustedLayer; children: JSX.Element }): JSX.Element {
  const holder = document.createElement('div');
  holder.style.display = 'contents';
  const trusted = createTrustedOverlayHost({ parent: holder, overlay: props.overlay, layer: props.layer });
  onMount(() => trusted.show());
  onCleanup(() => trusted.dispose());
  return <>{holder}<Portal mount={trusted.content}>{props.children}</Portal></>;
}

/**
 * While `active`, the trusted root that holds
 * `element` (a comment composer) is lifted above navigation, without remounting the draft, and put
 * back where it was after. Outside a trusted overlay (a unit test, a bare page) it does nothing.
 */
export function createForegroundComposer(active: Accessor<boolean>, element: Accessor<HTMLElement | undefined>): void {
  createEffect(() => {
    const node = element();
    if (!active() || !node) return;
    const shadow = node.getRootNode();
    const root = shadow instanceof ShadowRoot ? shadow.querySelector<HTMLElement>('[data-trusted-ui-root]') : null;
    const previous = root ? overlays.get(root) : undefined;
    if (!root || previous === undefined || typeof root.hidePopover !== 'function') return;
    const focused = (root.getRootNode() as ShadowRoot).activeElement;
    root.hidePopover();
    openOverlay(root, 3);
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    onCleanup(() => {
      if (!overlays.has(root)) return;
      root.hidePopover();
      openOverlay(root, previous);
    });
  });
}
