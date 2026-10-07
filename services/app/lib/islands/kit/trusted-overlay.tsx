/* @jsxImportSource solid-js */
import { Show, createUniqueId, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useIsland } from '../context';
import { STORY_ROOT_SELECTOR, type IslandContext } from '../contract';

export function overlayDestination(island: IslandContext, anchor?: HTMLElement): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  // Native modal contents live in the top layer. Their popups must share that owner;
  // a story-root portal remains behind the modal regardless of its z-index.
  // Inside the story root, the overlay inherits the story's font and theme, not the app shell's.
  const story = document.querySelector<HTMLElement>(STORY_ROOT_SELECTOR);
  return anchor?.closest<HTMLElement>('dialog[open]') ?? (story && document.querySelector('style[data-mx-story-css], style[data-mx-tw]')
    ? story : island.trustedPortal());
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
export function TrustedOverlay(props: { open: () => boolean; anchor?: () => HTMLElement | undefined; children: JSX.Element }): JSX.Element {
  const island = useIsland();
  const destination = () => props.open() ? overlayDestination(island, props.anchor?.()) : null;
  return <Show when={destination()} fallback={props.children}>{portal => <Portal mount={portal()}>{storyPortalHost(props.children)}</Portal>}</Show>;
}
