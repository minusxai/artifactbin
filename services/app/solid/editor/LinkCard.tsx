/* @jsxImportSource solid-js */
/**
 * The link card under the caret while editing prose: the link's address with Open, Edit and Remove when the caret
 * is in one, and the address box when ⌘K (or Edit) asks for one. It holds no document element: it sits at the rect
 * the document described, and every change goes back as the in-place editor's `applyLink`.
 */
import { createEffect, createSignal, on, Show, untrack, type JSX } from 'solid-js';
import ExternalLink from 'lucide-solid/icons/external-link';
import Link2Off from 'lucide-solid/icons/link-2-off';
import Pencil from 'lucide-solid/icons/pencil';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { Tooltip } from '@/solid/components/Tooltip';

interface LinkCardRect { x: number; y: number; width: number; height: number }

const CARD_WIDTH = 320;

export function LinkCard(props: {
  /** The caret or selected words, in this page's viewport. */
  at: LinkCardRect;
  /** The link the caret is in, if any. */
  href: string | null;
  editing: boolean;
  onEdit: () => void;
  onApply: (href: string | null) => void;
  /** Closed without a change: the caret goes back to the text. */
  onCancel: () => void;
  /** Focus moved elsewhere while the box was open: close it and leave focus there. */
  onDismiss: () => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal('');
  const [invalid, setInvalid] = createSignal(false);
  let input: HTMLInputElement | undefined;
  // Filled once as the box opens: the caret moving under it later must not overwrite what is being typed.
  createEffect(on(() => props.editing, (editing) => {
    if (!editing) return;
    setDraft(untrack(() => props.href) ?? '');
    setInvalid(false);
    queueMicrotask(() => { input?.focus(); input?.select(); });
  }));
  const position = () => {
    const below = props.at.y + props.at.height + 6;
    const top = below + 44 > window.innerHeight ? Math.max(8, props.at.y - 50) : below;
    const left = Math.max(8, Math.min(props.at.x, window.innerWidth - CARD_WIDTH - 8));
    return { top: `${top}px`, left: `${left}px`, 'max-width': `${CARD_WIDTH}px` };
  };
  const submit = () => {
    const value = draft().trim();
    if (!value) { props.onApply(null); return; }
    if (!normalizeLinkHref(value)) { setInvalid(true); return; }
    props.onApply(value);
  };
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const iconButton = 'inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-fg hover:bg-raised';

  return (
    <div role="group" aria-label={props.editing ? 'Edit link' : 'Link'} style={position()}
      class="fixed z-50 flex w-max min-w-0 flex-wrap items-center gap-1 rounded-md border border-edge bg-surface p-1 font-sans text-xs text-fg shadow-lg">
      <Show when={props.editing} fallback={
        <>
          <a href={props.href ?? '#'} target="_blank" rel="noopener noreferrer" onMouseDown={keepFocus}
            class="inline-flex min-w-0 max-w-56 items-center gap-1.5 truncate rounded-[3px] px-1.5 py-1 text-accent hover:bg-raised">
            <ExternalLink size={12} class="shrink-0" /><span class="truncate">{props.href}</span>
          </a>
          <Tooltip content="Edit link (⌘K)">
            <button type="button" aria-label="Edit link" onMouseDown={keepFocus} onClick={() => props.onEdit()} class={iconButton}><Pencil size={13} /></button>
          </Tooltip>
          <Tooltip content="Remove link">
            <button type="button" aria-label="Remove link" onMouseDown={keepFocus} onClick={() => props.onApply(null)} class={iconButton}><Link2Off size={13} /></button>
          </Tooltip>
        </>
      }>
        <form class="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <input ref={input} aria-label="Link URL" aria-invalid={invalid()} value={draft()} placeholder="Paste or type a link"
            onInput={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onCancel(); } }}
            onBlur={() => props.onDismiss()}
            class={`w-56 min-w-0 rounded-[3px] border bg-transparent px-1.5 py-1 text-xs text-fg focus:outline-none ${invalid() ? 'border-danger' : 'border-edge focus:border-edge-bright'}`} />
          <button type="submit" onMouseDown={keepFocus} class="cursor-pointer rounded-[3px] px-2 py-1 font-medium text-accent hover:bg-raised">Apply</button>
        </form>
      </Show>
      <Show when={props.editing && invalid()}>
        <span role="alert" class="w-full px-1.5 pb-0.5 text-[11px] text-danger">Enter a web address, like example.com</span>
      </Show>
    </div>
  );
}
