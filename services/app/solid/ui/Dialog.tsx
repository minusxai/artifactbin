/* @jsxImportSource solid-js */
/**
 * THE APP'S MODAL. Portalled to the trusted UI host (else <body>) over the one backdrop, at LAYER.dialog;
 * behaviour is the modal contract (lib/islands/kit/dialog-shell): Escape closes the top dialog, Tab is
 * trapped, focus starts inside (`initialFocus` selector, else the first focusable) and returns to the
 * opener on close. A backdrop press closes it too. While `busy`, neither Escape nor the backdrop closes it.
 * Named by its `title` (an h2) and described by `description`; `footer` holds the actions.
 */
import { createUniqueId, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';
import { LAYER } from './layers';

const SIZE = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog(props: {
  title: string;
  description?: JSX.Element;
  footer?: JSX.Element;
  size?: keyof typeof SIZE;
  busy?: boolean;
  onClose: () => void;
  /** Selector of the element to focus on open; defaults to the first focusable element. */
  initialFocus?: string;
  lockScroll?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  let panel!: HTMLDivElement;
  const heading = createUniqueId();
  const detail = createUniqueId();
  const close = () => { if (!props.busy) props.onClose(); };
  createDialogShell({
    panel: () => panel,
    onClose: close,
    lockScroll: props.lockScroll,
    initialFocus: () => (props.initialFocus ? panel.querySelector<HTMLElement>(props.initialFocus) : null) ?? panel.querySelector<HTMLElement>(FOCUSABLE),
  });
  return <Portal mount={trustedPortalOf(document) ?? document.body}>
    <div class="fixed inset-0 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" style={{ 'z-index': LAYER.dialog }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={props.description ? detail : undefined} aria-busy={props.busy || undefined}
        class={`relative max-h-[calc(100dvh-2rem)] w-full ${SIZE[props.size ?? 'sm']} overflow-y-auto rounded-dialog border border-edge-bright bg-surface p-6 font-sans text-fg shadow-2xl`}>
        <h2 id={heading} class="text-base font-semibold">{props.title}</h2>
        <Show when={props.description}><div id={detail} class="mt-2 break-words text-sm leading-relaxed text-muted">{props.description}</div></Show>
        <Show when={props.children}><div class="mt-4">{props.children}</div></Show>
        <Show when={props.footer}><div class="mt-6 flex flex-wrap justify-end gap-3">{props.footer}</div></Show>
      </div>
    </div>
  </Portal>;
}
