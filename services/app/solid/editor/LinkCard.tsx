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
import { normalizeLinkHref } from '@/lib/story-edit/link-edit';
import { Button } from '@/solid/ui/Button';
import { Input } from '@/solid/ui/Field';
import { Panel } from '@/solid/ui/Panel';
import { Tooltip } from '@/solid/ui/Tooltip';

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

  return (
    <div role="group" aria-label={props.editing ? 'Edit link' : 'Link'} style={position()} class="fixed z-50 w-max min-w-0">
    <Panel padding="none" class="flex flex-wrap items-center gap-1 p-1 font-sans text-xs text-fg shadow-lg">
      <Show when={props.editing} fallback={
        <>
          <Button variant="link" href={props.href ?? '#'} target="_blank" rel="noopener noreferrer" onMouseDown={keepFocus} class="mx-1.5 min-w-0 max-w-56 shrink gap-1.5 text-xs">
            <ExternalLink size={12} class="shrink-0" /><span class="min-w-0 truncate">{props.href}</span>
          </Button>
          <Tooltip content="Edit link (⌘K)">
            <Button variant="ghost" size="sm" icon aria-label="Edit link" onMouseDown={keepFocus} onClick={() => props.onEdit()}><Pencil size={13} /></Button>
          </Tooltip>
          <Tooltip content="Remove link">
            <Button variant="ghost" size="sm" icon aria-label="Remove link" onMouseDown={keepFocus} onClick={() => props.onApply(null)}><Link2Off size={13} /></Button>
          </Tooltip>
        </>
      }>
        <form class="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div class="w-56 min-w-0">
            <Input size="sm" ref={input} aria-label="Link URL" aria-invalid={invalid()} value={draft()} placeholder="Paste or type a link"
              onInput={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onCancel(); } }}
              onBlur={() => props.onDismiss()} />
          </div>
          <Button type="submit" variant="secondary" size="sm" onMouseDown={keepFocus}>Apply</Button>
        </form>
      </Show>
      <Show when={props.editing && invalid()}>
        <span role="alert" class="w-full px-1.5 pb-0.5 text-2xs text-danger">Enter a web address, like example.com</span>
      </Show>
    </Panel>
    </div>
  );
}
