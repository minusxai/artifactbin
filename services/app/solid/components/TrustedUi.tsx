/* @jsxImportSource solid-js */
/**
 * components/TrustedUi in SOLID — the CSS boundary for first-party UI on a page that also shows
 * author content (the document page). Children render into a shadow root carrying the app's own
 * sheet, so the document's stylesheet (its preflight, its utilities, its author rules) cannot restyle
 * them; as an overlay the root sits in the top layer so an author sibling cannot paint over it. Its
 * portal is where solid/components/Popover, Tooltip and MobileSheet mount (lib/islands/trusted-portal).
 */
import { onCleanup, onMount, type JSX } from 'solid-js';
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
