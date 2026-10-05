/* @jsxImportSource solid-js */
/** Standalone kit picker. Multi-selection is a draft until dismissal/Done; Escape cancels. */
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { useIsland } from '../context';
import { refName } from '@/lib/story/data/dataflow';
import { coerceScalarInput } from '@/lib/story/data/scalar-input';
import { TrustedOverlay } from './trusted-overlay';
import { popupDismiss } from './popup-dismiss';

const nameOf = (value: unknown) => refName(value) ?? '';
const rootProps = (props: object) => Object.fromEntries(Object.entries(props).filter(([key]) => key === 'id' || key.startsWith('data-')));
interface SelectProps { label?: string; value?: unknown; options?: unknown; placeholder?: string; className?: string; id?: string; disabled?: boolean; multiple?: boolean; valueFormat?: 'json'; allowCreate?: boolean; [key: `data-${string}`]: unknown }
const selectClass = 'mx-control relative inline-flex flex-col gap-1.5 align-top';
/** The former trigger classes in SelectControl's own order (`cn(base, field appearance)`). */
const SELECT_TRIGGER = 'inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40';
const selectJoin = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
const CHEVRON = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const CHECK = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
const parseSelection = (value: string | null): string[] | null => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) return [...new Set(parsed)];
  } catch { /* A malformed persisted value is never an empty selection. */ }
  return null;
};
export function Select(p: SelectProps) {
  const island = useIsland(); const [open,setOpen] = createSignal(false); const [query,setQuery] = createSignal(''); const [highlight,setHighlight] = createSignal(-1);
  const [draft, setDraft] = createSignal<string[]>([]);
  const valueName = () => nameOf(p.value);
  const optionsName = () => nameOf(p.options);
  // People remain scalar even when old markup happens to carry multi-select props.
  const multiple = () => p.multiple === true && island.valueType(valueName()) !== 'user';
  const current = () => valueName() ? island.value(valueName()) == null ? null : String(island.value(valueName())) : typeof p.value === 'string' ? p.value : typeof p.value === 'number' ? String(p.value) : null;
  const selection = createMemo(() => parseSelection(current()));
  const invalid = () => multiple() && selection() === null;
  const active = () => !!valueName() && Object.hasOwn(island.values(), valueName()) && p.disabled !== true && !invalid();
  const options = createMemo(() => {
    const name = optionsName();
    if (name) {
      const table = island.table(name);
      const [valueCol, labelCol] = table?.columns ?? [];
      return table && valueCol ? table.rows.filter(row => row[valueCol.name] !== null && row[valueCol.name] !== undefined && row[valueCol.name] !== '').map(row => ({ value: String(row[valueCol.name]), label: String(row[labelCol?.name ?? valueCol.name] ?? row[valueCol.name]) })) : [];
    }
    return Array.isArray(p.options) ? p.options.map(option => typeof option === 'object' && option !== null ? { value: String(option.value ?? ''), label: String(option.label ?? option.value ?? '') } : { value: String(option), label: String(option) }) : [];
  });
  const label = () => multiple()
    ? selection()?.map(value => options().find(o => o.value === value)?.label ?? value).join(', ') || p.placeholder || 'All'
    : current() === null ? p.placeholder ?? 'All' : options().find(o => o.value === current())?.label ?? current();
  // An authored placeholder is the null choice (`$x is null` in SQL); without one the popup lists only the
  // authored options, so a document that adds its own "All" row doesn't get a second one.
  const entries = () => [
    ...(!multiple() && valueName() && p.placeholder !== undefined ? [{ value: null, label: p.placeholder }] : []), ...options(),
    ...(multiple() ? draft().filter(value => !options().some(o => o.value === value)).map(value => ({ value, label: value })) : []),
  ];
  const filtered = () => entries().filter(o => o.label.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()));
  const canCreate = () => multiple() && p.allowCreate === true && !!query().trim() && !entries().some(o => o.value === query().trim());
  const selected = (value: string | null) => multiple() ? value !== null && draft().includes(value) : value === current();
  const close = (commit = true, focus = false) => {
    if (!open()) return;
    const value = JSON.stringify(draft());
    setOpen(false); setQuery(''); setHighlight(-1);
    if (commit && multiple() && active()) island.setValue(valueName(), value, undefined);
    if (focus) trigger?.focus();
  };
  // The popup speaks strings throughout (display and comparison); a write goes through the bound
  // Value's declared type first — the same coercion the former NativeBoundControl applies — so a number
  // or boolean Value never receives the option's string back verbatim (kit/controls.tsx BoundNative).
  const choose = (value: string | null) => {
   if (!active()) return;
   if (multiple() && value !== null) {
    setDraft(values => values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
    setQuery(''); setHighlight(-1); search?.focus(); return;
   }
   const name = valueName();
   if (name) {
    const type = island.valueType(name);
    island.setValue(name, coerceScalarInput(type, value ?? ''), undefined);
   }
   close(false, true);
  };
  let root!: HTMLDivElement; let trigger!: HTMLButtonElement; let popup: HTMLDivElement | undefined; let search: HTMLInputElement | undefined;
  const announce = popupDismiss(open, () => close(), () => trigger, () => popup, () => close(false));
  const openList = () => {
    if (!active() || open()) return;
    announce(); setDraft(selection() ?? []); setQuery(''); setHighlight(-1); setOpen(true);
    queueMicrotask(() => { if (open() && search?.isConnected) search.focus(); });
  };
  const create = () => { if (canCreate() && active()) choose(query().trim()); };
  const searchKey = (event: KeyboardEvent) => {
    const count = filtered().length + (canCreate() ? 1 : 0);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setHighlight(i => Math.max(0, Math.min(count - 1, i + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); setHighlight(event.key === 'Home' ? 0 : count - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered()[highlight()];
      if (option) choose(option.value); else create();
    }
  };
  const triggerKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); openList(); setHighlight(event.key === 'ArrowDown' ? 0 : entries().length - 1);
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); openList(); setQuery(event.key); setHighlight(filtered().length ? 0 : -1);
    }
  };
  const blur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !root?.contains(next) && !popup?.contains(next)) close();
  };
  createEffect(() => { if (!active()) untrack(() => close(false)); });
  // No `data-mx-bound` stamp: that marks the former STATIC render of a bound control; the live SelectAdapter never writes it.
  return <div {...rootProps(p)} class={selectJoin(selectClass,p.className)}>
    <Show when={p.label}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{p.label}</span></span></Show>
    <div ref={root} class="relative min-w-0" on:focusout={blur}><button ref={trigger} type="button" aria-label={p.label} aria-haspopup="listbox" aria-expanded={open()} disabled={!active()} on:click={() => open() ? close(true, true) : openList()} on:keydown={triggerKey}
      class={SELECT_TRIGGER}>
      <span class={selectJoin('truncate',current() === null && 'text-muted-foreground')}>{label()}</span><CHEVRON /></button>
      <TrustedOverlay open={open}><Show when={open()}><div ref={popup} on:focusout={blur} data-theme={root.closest<HTMLElement>('[data-theme]')?.dataset.theme} class="rounded-md border border-border bg-popover text-popover-foreground shadow-md" style={{position:'fixed', 'z-index':50, left:`${root.getBoundingClientRect().left}px`, top:`${root.getBoundingClientRect().bottom + 4}px`, width:`${Math.max(root.getBoundingClientRect().width,200)}px`, '--popover': getComputedStyle(root).getPropertyValue('--popover'), '--popover-foreground': getComputedStyle(root).getPropertyValue('--popover-foreground'), '--border': getComputedStyle(root).getPropertyValue('--border')}}>
        <div class="border-b border-border p-1.5"><input ref={search} type="text" role="searchbox" aria-label={p.label ? `Search ${p.label}` : 'Search options'} placeholder="Type to filter…" value={query()} on:keydown={searchKey}
          on:input={e => { const q = e.currentTarget.value; setQuery(q); setHighlight(filtered().length ? 0 : -1); }}
          class="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
        <div role="listbox" aria-label={p.label} aria-multiselectable={multiple() ? 'true' : undefined} class="max-h-56 overflow-y-auto p-1" on:mousedown={event => event.preventDefault()}><For each={filtered()}>{(o,i) => <button type="button" role="option" aria-label={o.label} aria-selected={selected(o.value)}
          on:click={() => choose(o.value)} on:mouseenter={() => setHighlight(i())}
          class={selectJoin('flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm',i() === highlight() && 'bg-accent text-accent-foreground',o.value === null && o.value !== current() && 'text-muted-foreground')}>
          <span class="truncate">{o.label}</span><Show when={selected(o.value)}><CHECK /></Show></button>}</For>
          <Show when={canCreate()} fallback={<Show when={filtered().length === 0}><div role="status" class="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div></Show>}>
            <button type="button" role="option" aria-label={`Create ${query().trim()}`} aria-selected="false" on:click={create} on:mouseenter={() => setHighlight(filtered().length)} class={selectJoin('flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm', highlight() === filtered().length && 'bg-accent text-accent-foreground')}>Create “{query().trim()}”</button>
          </Show></div>
        <Show when={multiple()}><div class="flex justify-end border-t border-border p-1.5"><button type="button" aria-label="Done" on:mousedown={event => event.preventDefault()} on:click={() => close(true, true)} class="rounded-sm px-2 py-1 text-sm font-medium hover:bg-accent">Done</button></div></Show>
      </div></Show></TrustedOverlay>
      <Show when={invalid()}><span role="alert">Expected a JSON array of strings.</span></Show>
    </div></div>;
}


/**
 * A `<Column>` of the table. The compiler passes `{ col, id, path, ids }` (the column's author id and AST
 * path, which the former header cell carries, and its content's author ids) beside the parsed `columns`; the
 * interpreter's shape also carries the column's `props` and its cell template `nodes`.
 */
