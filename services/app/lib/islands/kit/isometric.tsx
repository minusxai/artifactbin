/* @jsxImportSource solid-js */
import { getOwner, onCleanup, onMount, splitProps } from 'solid-js';
import { render } from 'solid-js/web';
import { deferEngine } from '../defer-engine';
import { ISOMETRIC_PROPS, type IsometricProps } from './isometric-props';

/** Adopt the server's SVG without rebuilding it during hydration. The interactive renderer
 * intentionally loads after reader readiness; prose and the initial drawing need no engine. */
export function Isometric(props: IsometricProps) {
  const [drawing, rest] = splitProps(props, ISOMETRIC_PROPS);
  const owner = getOwner();
  let host!: HTMLDivElement;
  onMount(() => {
    let disposed = false;
    let unmount = () => {};
    const cancel = deferEngine(host, () => {
      void import('./isometric-drawing').then(({ IsometricDrawing }) => {
        if (disposed) return;
        // Build before replacing the served SVG, so a loading failure leaves the drawing visible.
        const stage = host.ownerDocument.createElement('div');
        // Keep the page's Value context when mounting outside the original hydration task.
        unmount = render(() => <IsometricDrawing {...drawing} />, stage, undefined, { owner });
        host.replaceChildren(...stage.childNodes);
      }).catch(() => {
        if (disposed) return;
        const message = host.ownerDocument.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = 'Interactive drawing could not load. Reload to try again.';
        host.append(message);
      });
    });
    onCleanup(() => { disposed = true; cancel(); unmount(); });
  });
  return <div {...rest} ref={host} data-slot="isometric" />;
}
