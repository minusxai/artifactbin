/* @jsxImportSource solid-js */
/** Interaction-only Select view. State and writes remain in the owning control. */
import { For, Show, onMount } from 'solid-js';
export interface SelectPopupProps {
  root: HTMLElement; label?: string; query: string; multiple: boolean; current: string | null;
  filtered: { value: string | null; label: string }[]; highlight: number; canCreate: boolean;
  popupRef(el: HTMLDivElement): void; searchRef(el: HTMLInputElement): void;
  blur(event: FocusEvent): void; searchKey(event: KeyboardEvent): void;
  setQuery(value: string): void; setHighlight(index: number): void;
  choose(value: string | null): void; selected(value: string | null): boolean;
  create(): void; done(): void;
}
const selectJoin = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
const CHECK = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
export default function SelectPopup(p: SelectPopupProps) {
  let search!: HTMLInputElement;
  onMount(() => { p.searchRef(search); queueMicrotask(() => { if (search.isConnected) search.focus(); }); });
  return <div ref={p.popupRef} on:focusout={p.blur} data-theme={p.root.closest<HTMLElement>('[data-theme]')?.dataset.theme} class="rounded-md border border-border bg-popover text-popover-foreground shadow-md" style={{position:'fixed', 'z-index':50, left:`${p.root.getBoundingClientRect().left}px`, top:`${p.root.getBoundingClientRect().bottom + 4}px`, width:`${Math.max(p.root.getBoundingClientRect().width,200)}px`, '--popover': getComputedStyle(p.root).getPropertyValue('--popover'), '--popover-foreground': getComputedStyle(p.root).getPropertyValue('--popover-foreground'), '--border': getComputedStyle(p.root).getPropertyValue('--border')}}>
        <div class="border-b border-border p-1.5"><input ref={search} type="text" role="searchbox" aria-label={p.label ? `Search ${p.label}` : 'Search options'} placeholder="Type to filter…" value={p.query} on:keydown={p.searchKey}
          on:input={e => { const q = e.currentTarget.value; p.setQuery(q); }}
          class="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
        <div role="listbox" aria-label={p.label} aria-multiselectable={p.multiple ? 'true' : undefined} class="max-h-56 overflow-y-auto p-1" on:mousedown={event => event.preventDefault()}><For each={p.filtered}>{(o,i) => <button type="button" role="option" aria-label={o.label} aria-selected={p.selected(o.value)}
          on:click={() => p.choose(o.value)} on:mouseenter={() => p.setHighlight(i())}
          class={selectJoin('flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm',i() === p.highlight && 'bg-accent text-accent-foreground',o.value === null && o.value !== p.current && 'text-muted-foreground')}>
          <span class="truncate">{o.label}</span><Show when={p.selected(o.value)}><CHECK /></Show></button>}</For>
          <Show when={p.canCreate} fallback={<Show when={p.filtered.length === 0}><div role="status" class="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div></Show>}>
            <button type="button" role="option" aria-label={`Create ${p.query.trim()}`} aria-selected="false" on:click={p.create} on:mouseenter={() => p.setHighlight(p.filtered.length)} class={selectJoin('flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm', p.highlight === p.filtered.length && 'bg-accent text-accent-foreground')}>Create “{p.query.trim()}”</button>
          </Show></div>
        <Show when={p.multiple}><div class="flex justify-end border-t border-border p-1.5"><button type="button" aria-label="Done" on:mousedown={event => event.preventDefault()} on:click={p.done} class="rounded-sm px-2 py-1 text-sm font-medium hover:bg-accent">Done</button></div></Show>
      </div>;
}
