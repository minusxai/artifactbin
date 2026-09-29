/* @jsxImportSource solid-js */
/**
 * THE OVERFLOW MENU BEHIND A ROW'S "…" (components/RowMenu.tsx in Solid). Same interface — a list of
 * items — with one change a port must make: `icon` is a FUNCTION returning the element. In React an
 * element is a description that can be rendered anywhere; in Solid, JSX evaluates to a real DOM node,
 * and a prop getter that builds one would build a fresh node on every read (or, read once, a single
 * node that can only live in one place).
 *
 * Items are rendered with <Index>, not <For>: callers build a fresh items array (fresh objects) on
 * every reactive read, and <For> keys by object identity, so it would recreate every button whenever
 * `busy` changed — dropping focus. <Index> keys by position and updates the fields in place.
 *
 * `useDeleteArtifact` (the confirm-then-delete helper beside the React RowMenu) is not ported: Trash
 * does not use it, and in React it is why ConfirmDialog rides in every RowMenu importer's chunk.
 */
import { createEffect, createSignal, Index, onCleanup, Show, type JSX } from 'solid-js';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { Tooltip } from './Tooltip';

export interface RowMenuItem {
  /** Reads as an aria-label, so it names the row: `Delete My doc`. */
  label: string;
  text: string;
  icon: () => JSX.Element;
  onSelect: () => void;
  danger?: boolean;
  /** Offered but refused: the caller puts the reason in `text`. */
  disabled?: boolean;
}

const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors';

export default function RowMenu(props: { name: string; items: RowMenuItem[] }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let box!: HTMLSpanElement;

  // A menu that outlives the click that dismissed it is the bug every hand-rolled popover ships once.
  createEffect(() => {
    if (!open()) return;
    const away = (e: MouseEvent) => { if (!box.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    onCleanup(() => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    });
  });

  return (
    <Show when={props.items.length > 0}>
      <span ref={box} class="relative z-10 inline-flex">
        <Tooltip content="more">
          <button
            type="button"
            class={`${ICON_ACTION} ${open() ? 'text-fg' : 'hover:text-accent'}`}
            aria-label={`More actions for ${props.name}`}
            aria-expanded={open()}
            onClick={() => setOpen((o) => !o)}
          >
            <Ellipsis size={13} />
          </button>
        </Tooltip>
        <Show when={open()}>
          <div class="absolute right-0 top-full z-30 mt-1 min-w-36 whitespace-nowrap rounded-[6px] border border-edge bg-surface p-1 font-mono text-xs shadow-lg">
            <Index each={props.items}>
              {(item) => (
                <button
                  type="button"
                  aria-label={item().label}
                  disabled={item().disabled}
                  class={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-muted disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent enabled:cursor-pointer enabled:hover:bg-raised ${item().danger ? 'enabled:hover:text-danger' : 'enabled:hover:text-fg'}`}
                  onClick={() => {
                    // Callers may open a dialog and move focus there; focusing the
                    // trigger first recursively reopens its tooltip during disposal.
                    setOpen(false);
                    item().onSelect();
                  }}
                >
                  {item().icon()} {item().text}
                </button>
              )}
            </Index>
          </div>
        </Show>
      </span>
    </Show>
  );
}
