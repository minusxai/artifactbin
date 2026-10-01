/* @jsxImportSource solid-js */
import { Show, createUniqueId, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useIsland } from '../context';
import { STORY_ROOT_SELECTOR, type IslandContext } from '../contract';

export function overlayDestination(island: IslandContext): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  // Inside the story root, the overlay inherits the story's font and theme, not the app shell's.
  const story = document.querySelector<HTMLElement>(STORY_ROOT_SELECTOR);
  return story && document.querySelector('style[data-mx-story-css], style[data-mx-tw]')
    ? story : island.trustedPortal();
}

/**
 * A portal's mount can land directly under the story root (its only styled, unclipped ancestor),
 * outside every island's own hydration boundary. Give the portaled content its own hydration key
 * (`s-…`, one live island of its own) so it reads as Solid-owned, dynamic content — never as a
 * served static node — and so a story update can find and retire it like any other island.
 */
export function storyPortalHost(children: JSX.Element): JSX.Element {
  const key = `s-${createUniqueId()}`;
  // A literal `data-hk` in JSX trips Solid's own hydration-mismatch lint; set it imperatively instead.
  return <div ref={(el) => el.setAttribute('data-hk', key)} style={{ display: 'contents' }}>{children}</div>;
}

/** Story CSS lives in the document, outside the app's shadow portal. Keep compiled kit
 * overlays in that styled document; other island hosts can use their trusted portal. */
export function TrustedOverlay(props: { open: () => boolean; children: JSX.Element }): JSX.Element {
  const island = useIsland();
  const destination = () => props.open() ? overlayDestination(island) : null;
  return <Show when={destination()} fallback={props.children}>{portal => <Portal mount={portal()}>{storyPortalHost(props.children)}</Portal>}</Show>;
}
