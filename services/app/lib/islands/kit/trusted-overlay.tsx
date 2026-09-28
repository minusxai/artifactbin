/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useIsland } from '../context';

/** Resolve the first-party destination when an overlay opens; a missing host keeps it inline. */
export function TrustedOverlay(props: { open: () => boolean; children: JSX.Element }): JSX.Element {
  const island = useIsland();
  const destination = () => props.open() ? island.trustedPortal() : null;
  return <Show when={destination()} fallback={props.children}>{portal => <Portal mount={portal()}>{props.children}</Portal>}</Show>;
}
