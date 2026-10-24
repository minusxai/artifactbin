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
  const initialMode = options.mode ?? (options.win.document.documentElement.hasAttribute('data-af-dark') ? 'dark' : 'light');
  options.win.document.documentElement.toggleAttribute('data-af-dark', initialMode === 'dark');
  const [current, setCurrent] = createSignal<PortableChromeUpdate>({ state: options.state, title: options.title, kind: options.kind, identity: options.identity, mode: initialMode });
  let disposed = false;
  const pickMode = (mode: 'light' | 'dark') => {
    if (disposed) return;
    options.win.document.documentElement.toggleAttribute('data-af-dark', mode === 'dark');
    setCurrent(previous => ({ ...previous, mode }));
    options.onMode?.(mode);
  };
  const unmount = render(() => <PortableChrome {...options} current={current()} onMode={pickMode} />, boundary.content);
  return {
    update(next) {
      if (disposed) return;
      if (next.mode) options.win.document.documentElement.toggleAttribute('data-af-dark', next.mode === 'dark');
      setCurrent(previous => ({ ...previous, ...next }));
    },
    dispose() { if (disposed) return; disposed = true; unmount(); boundary.dispose(); },
  };
}
