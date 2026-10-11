/* @jsxImportSource solid-js */
/**
 * THE APP'S MODAL. Portalled to the trusted UI host (else <body>) over the one backdrop, at LAYER.dialog — under
 * every popover, menu and tooltip, so a Select inside it opens above it. Behaviour is the modal contract
 * (lib/islands/kit/dialog-shell): Escape closes the top dialog, Tab is trapped, focus starts inside
 * (`initialFocus` selector, else the first focusable) and returns to the opener on close. A backdrop press
 * closes it too. While `busy`, or always when `dismissible={false}` (a recovery that must be answered), neither
 * Escape nor the backdrop closes it.
 *
 * Named by its `title` (an h2), or by `label` when the name differs from what it shows; described by
 * `description`. The header (title, description, `closeLabel`'s × button) and the `footer` of actions stay put
 * while the body scrolls; `body="flush"` drops the body's side padding for an edge-to-edge stage. `align="top"`
 * seats it under the page's bars instead of centring it. It takes the appearance of where it is rendered, else of its opener
 * (solid/ui/theme).
 */
import { createUniqueId, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import X from 'lucide-solid/icons/x';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';
import { Button } from './Button';
import { LAYER } from './layers';
import { createPlacedAppearance } from './theme';

const SIZE = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;
const ALIGN = { center: 'items-center', top: 'items-start pt-[min(6rem,12vh)]' } as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog(props: {
  title: string;
  /** The accessible name when it is not the visible title. */
  label?: string;
  description?: JSX.Element;
  footer?: JSX.Element;
  size?: keyof typeof SIZE;
  align?: keyof typeof ALIGN;
  /** Draws a × button in the header, named this. */
  closeLabel?: string;
  /** `flush` drops the body's side padding (a full-bleed stage). */
  body?: 'padded' | 'flush';
  role?: 'dialog' | 'alertdialog';
  /** `false`: Escape and the backdrop never close it; only an action inside does. */
  dismissible?: boolean;
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
  const placed = createPlacedAppearance();
  const dismiss = () => { if (!props.busy && props.dismissible !== false) props.onClose(); };
  createDialogShell({
    panel: () => panel,
    onClose: dismiss,
    lockScroll: props.lockScroll,
    initialFocus: () => (props.initialFocus ? panel.querySelector<HTMLElement>(props.initialFocus) : null) ?? panel.querySelector<HTMLElement>(FOCUSABLE),
  });
  const side = () => (props.body === 'flush' ? '' : 'px-6');
  return <><span ref={placed.marker} hidden /><Portal mount={trustedPortalOf(document) ?? document.body}>
    <div data-app-appearance={placed.appearance()} class={`fixed inset-0 flex justify-center bg-black/45 p-4 backdrop-blur-[2px] ${ALIGN[props.align ?? 'center']}`} style={{ 'z-index': LAYER.dialog }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <div ref={panel} role={props.role ?? 'dialog'} aria-modal="true" aria-label={props.label} aria-labelledby={props.label ? undefined : heading}
        aria-describedby={props.description ? detail : undefined} aria-busy={props.busy || undefined}
        class={`relative flex max-h-[calc(100dvh-2rem)] w-full ${SIZE[props.size ?? 'sm']} flex-col overflow-hidden rounded-dialog border border-edge-bright bg-surface font-sans text-fg shadow-2xl`}>
        <header class="flex shrink-0 items-start gap-3 px-6 pt-6">
          <div class="min-w-0 flex-1">
            <h2 id={heading} class="text-base font-semibold">{props.title}</h2>
            <Show when={props.description}><div id={detail} class="mt-2 break-words text-sm leading-relaxed text-muted">{props.description}</div></Show>
          </div>
          <Show when={props.closeLabel}>{(label) => <Button variant="ghost" size="sm" icon aria-label={label()} disabled={props.busy} onClick={() => props.onClose()} class="-mr-2 -mt-1"><X size={15} aria-hidden="true" /></Button>}</Show>
        </header>
        <Show when={props.children}><div data-dialog-body="" class={`mt-4 min-h-0 flex-1 overflow-y-auto ${side()} ${props.footer ? '' : 'pb-6'}`}>{props.children}</div></Show>
        <Show when={props.footer} fallback={<Show when={!props.children}><div class="pb-6" /></Show>}><div class="mt-6 flex shrink-0 flex-wrap justify-end gap-3 px-6 pb-6">{props.footer}</div></Show>
      </div>
    </div>
  </Portal></>;
}
