/* @jsxImportSource solid-js */
/** Standalone kit picker. Multi-selection is a draft until dismissal/Done; Escape cancels. */
import { createEffect, createMemo, createSignal, Show, untrack, type Component } from 'solid-js';
import { useIsland } from '../context';
import { refName } from '@/lib/story/data/dataflow';
import { coerceScalarInput } from '@/lib/story/data/scalar-input';
import { TrustedOverlay } from './trusted-overlay';
import { popupDismiss } from './popup-dismiss';
import type { SelectPopupProps } from './select-popup';

// The searchable menu is only needed after interaction; the SSR trigger stays in the ready-time bundle.
let menuComponent: Component<SelectPopupProps> | undefined;
let menuLoading: Promise<Component<SelectPopupProps>> | undefined;
export const loadSelectPopup = () => menuLoading ??= import('./select-popup').then(module => menuComponent = module.default).catch(error => { menuLoading = undefined; throw error; });

const nameOf = (value: unknown) => refName(value) ?? '';
const rootProps = (props: object) => Object.fromEntries(Object.entries(props).filter(([key]) => key === 'id' || key.startsWith('data-')));
interface SelectProps { label?: string; value?: unknown; options?: unknown; placeholder?: string; className?: string; id?: string; disabled?: boolean; multiple?: boolean; valueFormat?: 'json'; allowCreate?: boolean; [key: `data-${string}`]: unknown }
const selectClass = 'mx-control relative inline-flex flex-col gap-1.5 align-top';
/** The former trigger classes in SelectControl's own order (`cn(base, field appearance)`). */
const SELECT_TRIGGER = 'inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40';
const selectJoin = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
const CHEVRON = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const parseSelection = (value: string | null): string[] | null => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) return [...new Set(parsed)];
  } catch { /* A malformed persisted value is never an empty selection. */ }
  return null;
};
export function Select(p: SelectProps) {
  const [Menu, setMenu] = createSignal(menuComponent);
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
    if (!Menu()) void loadSelectPopup().then(component => setMenu(() => component), () => close(false, true));
    announce(); setDraft(selection() ?? []); setQuery(''); setHighlight(-1); setOpen(true);
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
    const check = (next: Node | null) => { if (next && !root?.contains(next) && !popup?.contains(next)) close(); };
    const next = event.relatedTarget as Element | null;
    // The destination is a shadow host during focusout; activeElement settles after focusin.
    if (next?.shadowRoot) queueMicrotask(() => {
      let active = root.ownerDocument.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      check(active);
    }); else check(next);
  };
  createEffect(() => { if (!active()) untrack(() => close(false)); });
  // No `data-mx-bound` stamp: that marks the former STATIC render of a bound control; the live SelectAdapter never writes it.
  return <div {...rootProps(p)} class={selectJoin(selectClass,p.className)}>
    <Show when={p.label}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{p.label}</span></span></Show>
    <div ref={root} class="relative min-w-0" on:focusout={blur}><button ref={trigger} type="button" aria-label={p.label} aria-haspopup="listbox" aria-expanded={open()} disabled={!active()} on:click={() => open() ? close(true, true) : openList()} on:keydown={triggerKey}
      class={SELECT_TRIGGER}>
      <span class={selectJoin('truncate',current() === null && 'text-muted-foreground')}>{label()}</span><CHEVRON /></button>
      <TrustedOverlay open={open} anchor={() => root}><Show when={open()}><Show when={Menu()}>{loaded => { const View = loaded(); return <View root={root} label={p.label} query={query()} multiple={multiple()} current={current()}
        filtered={filtered()} highlight={highlight()} canCreate={canCreate()} popupRef={el => popup = el} searchRef={el => search = el}
        blur={blur} searchKey={searchKey} setQuery={q => { setQuery(q); setHighlight(filtered().length ? 0 : -1); }}
        setHighlight={setHighlight} choose={choose} selected={selected} create={create} done={() => close(true, true)} />; }}</Show></Show></TrustedOverlay>
      <Show when={invalid()}><span role="alert">Expected a JSON array of strings.</span></Show>
    </div></div>;
}
