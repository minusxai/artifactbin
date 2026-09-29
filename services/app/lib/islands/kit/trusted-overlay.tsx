/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useIsland } from '../context';
import type { IslandContext } from '../contract';

export function overlayDestination(island: IslandContext): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  // Inside the story root, the overlay inherits the story's font and theme, not the app shell's.
  const story = document.querySelector<HTMLElement>('[data-mx-inline-story]');
  return story && document.querySelector('style[data-mx-story-css], style[data-mx-tw]')
    ? story : island.trustedPortal();
}

/** Story CSS lives in the document, outside the app's shadow portal. Keep compiled kit
 * overlays in that styled document; other island hosts can use their trusted portal. */
export function TrustedOverlay(props: { open: () => boolean; children: JSX.Element }): JSX.Element {
  const island = useIsland();
  const destination = () => props.open() ? overlayDestination(island) : null;
  return <Show when={destination()} fallback={props.children}>{portal => <Portal mount={portal()}>{props.children}</Portal>}</Show>;
}
