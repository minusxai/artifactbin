/* @jsxImportSource solid-js */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { PortableChrome } from '@/solid/document/PortableChrome';
import { createTrustedOverlayHost } from '@/lib/islands/trusted-overlay-host';
import { configureTrustedUiStyles } from '@/lib/islands/trusted-ui-styles';
import type { PortableChromeHandle, PortableChromeOptions, PortableChromeUpdate } from '@/lib/html-runtime/portable-chrome-contract';

/** Explicit mounting consumes bundled CSS and callbacks only. It never fetches or authenticates. */
export function mountPortableChrome(options: PortableChromeOptions): PortableChromeHandle {
  configureTrustedUiStyles(options.stylesheet);
  const boundary = createTrustedOverlayHost({ doc: options.win.document, layer: 'navigation', overlay: true });
  boundary.host.setAttribute('data-af-local-chrome', '');
  const [current, setCurrent] = createSignal<PortableChromeUpdate>({ state: options.state, title: options.title, kind: options.kind, identity: options.identity });
  const unmount = render(() => <PortableChrome {...options} current={current()} />, boundary.content);
  let disposed = false;
  return {
    update(next) { if (!disposed) setCurrent(previous => ({ ...previous, ...next })); },
    dispose() { if (disposed) return; disposed = true; unmount(); boundary.dispose(); },
  };
}
