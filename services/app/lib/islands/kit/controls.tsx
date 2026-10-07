/* @jsxImportSource solid-js */
import { For, Show, createEffect, createSignal, untrack, type JSX } from 'solid-js';
import { format as d3format } from 'd3-format';
import { TrustedOverlay } from './trusted-overlay';
import { popupDismiss } from './popup-dismiss';
import { refName, type Scalar, type TableResult } from '@/lib/story/data/dataflow';
import { coerceScalarInput } from '@/lib/story/data/scalar-input';
import { useIsland } from '../context';

type Props = Record<string, unknown>;
const join = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const lit = (v: unknown) => typeof v === 'string' && !refName(v) ? v : typeof v === 'number' ? String(v) : null;
const nameOf = (p: Props, key = 'value') => typeof p[key] === 'string' ? refName(p[key] as string) : null;
const valueOf = (p: Props, key = 'value'): Scalar | undefined => { const name = nameOf(p, key); return name ? useIsland().value(name) : p[key] as Scalar | undefined; };
const active = (p: Props, key = 'value') => { const name = nameOf(p, key); return !!name && Object.hasOwn(useIsland().values(), name) && p.disabled !== true; };
const shellClass = 'mx-control relative inline-flex flex-col gap-1.5 align-top';
const fieldClass = 'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
const SHELL_OMIT = new Set(['label','placeholder','className','value','options','multiple','allowCreate','valueFormat','checked','min','max','step','format','prefix','suffix','disabled','children','data']);
function shellRest(p: Props, extra: string[] = []) { const omit = new Set([...SHELL_OMIT, ...extra]); return Object.fromEntries(Object.entries(p).filter(([k]) => !omit.has(k))) as JSX.HTMLAttributes<HTMLDivElement>; }
function Shell(p: { authored: Props; children: JSX.Element; trailing?: JSX.Element; extra?: string[] }) {
  // The live control: the former runtime adapters never stamp `data-mx-bound` (only the registry's static face does).
  return <div {...shellRest(p.authored, p.extra)} class={join(shellClass, str(p.authored.className))}>
    <Show when={p.authored.label || p.trailing}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      <Show when={p.authored.label}><span>{str(p.authored.label)}</span></Show><Show when={p.trailing}><span class="ml-auto normal-case tracking-normal tabular-nums text-foreground">{p.trailing}</span></Show>
    </span></Show>{p.children}</div>;
}
const INPUT_TYPES = new Set(['text','number','email','url','search','password']);
function TextField(p: Props & { multiline?: boolean }) {
  const island = useIsland(); const v = () => nameOf(p) ? String(valueOf(p) ?? '') : lit(p.value) ?? '';
  const label = str(p['aria-label']) ?? str(p.label);
  const field = { 'aria-label': label, placeholder: str(p.placeholder), required: p.required === true || undefined, autofocus: p.autoFocus === true || undefined,
    disabled: !active(p), readOnly: !nameOf(p) || undefined };
  const input = (e: InputEvent) => { const n = nameOf(p); if (n) island.setValue(n, coerceScalarInput(island.valueType(n), (e.target as HTMLInputElement).value), { debounce: true }); };
  return <Shell authored={p} extra={['type','required','autoFocus','rows','readOnly','name','run','aria-label','multiline']}>
    {/* A textarea's value is its content, as React serves it (no `value` attribute); the live value is the property. */}
    {p.multiline ? <textarea {...field} {...({ 'prop:value': v() } as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)} textContent={untrack(v)} on:input={input} rows={typeof p.rows === 'number' ? p.rows : 3} class={join(fieldClass,'min-w-64 resize-y py-2 leading-normal')} /> :
      <input {...field} value={v()} on:input={input} ref={el => el.setAttribute('value',v())} type={typeof p.type === 'string' && INPUT_TYPES.has(p.type) ? p.type : 'text'} min={p.min as string | number | undefined} max={p.max as string | number | undefined} step={p.step as string | number | undefined} class={join(fieldClass,'h-9 min-w-48',p.type === 'number' && 'tabular-nums')} />}</Shell>;
}
export const Input = (p: Props) => <TextField {...p} />;
export const Textarea = (p: Props) => <TextField {...p} multiline />;

type Option = { value: string; label: string };
function normalize(raw: unknown, table?: TableResult): Option[] {
  if (typeof raw === 'string' && refName(raw)) { const [v,l] = table?.columns ?? []; return table && v ? table.rows.map(r => ({ value: String(r[v.name] ?? ''), label: String(r[l?.name ?? v.name] ?? r[v.name] ?? '') })) : []; }
  return Array.isArray(raw) ? raw.map(x => typeof x === 'object' && x !== null ? { value: String(x.value ?? ''), label: String(x.label ?? x.value ?? '') } : { value: String(x), label: String(x) }) : [];
}
function options(p: Props) { const n = nameOf(p,'options'); return normalize(p.options, n ? useIsland().table(n) : undefined); }
const nullable = (p: Props) => { const name = nameOf(p); return !!name && useIsland().nullable(name); };
const choiceValue = (p: Props) => nameOf(p) ? valueOf(p) == null ? null : String(valueOf(p)) : lit(p.value);
export function Segmented(p: Props) {
  // "All" only when the bound Value's declared default is null;
  // without the declarations (no store), the static face's rule: a bound value may offer it.
  const island = useIsland(); const entries = () => [...(nullable(p) ? [{ value: null, label: str(p.placeholder) ?? 'All' }] : []), ...options(p)];
  return <Shell authored={p}><div role="group" aria-label={str(p.label)} class="inline-flex w-fit items-center gap-0.5 rounded-md border border-input bg-muted/40 p-0.5 shadow-xs"><For each={entries()}>{o =>
    <button type="button" aria-pressed={o.value === choiceValue(p)} disabled={!active(p)} on:click={() => { const n = nameOf(p); if (n) island.setValue(n,o.value,undefined); }}
      class={join('h-8 rounded-[5px] px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',o.value === choiceValue(p) ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{o.label}</button>}</For></div></Shell>;
}
export function Switch(p: Props) {
  const island = useIsland(); const checked = () => { const n = nameOf(p,'checked'); const value = n ? island.value(n) : p.checked; return value === true || value === 'true'; };
  return <Shell authored={p}><button type="button" role="switch" aria-label={str(p.label)} aria-checked={checked()} disabled={!active(p,'checked')}
    on:click={() => { const n = nameOf(p,'checked'); if (n) island.setValue(n,!checked(),undefined); }}
    class={join('inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',checked() ? 'bg-primary' : 'bg-input')}>
    <span aria-hidden="true" class={join('block size-4 rounded-full bg-background shadow-sm transition-transform',checked() ? 'translate-x-[18px]' : 'translate-x-0.5')} /></button></Shell>;
}
export function Slider(p: Props) {
  const island = useIsland(); const min = typeof p.min === 'number' ? p.min : 0; const max = typeof p.max === 'number' ? p.max : 100;
  const value = () => { if (!nameOf(p)) return typeof p.value === 'number' ? p.value : null; const raw = valueOf(p); return raw == null ? null : Number(raw); };
  // The former readout (SliderControl): the value through its d3 `format`, the raw number for a bad spec.
  const readout = () => { const v = value(); if (v == null || Number.isNaN(v)) return '—'; let text = String(v); const f = str(p.format); if (f) { try { text = d3format(f)(v); } catch { /* bad spec: raw number */ } } return `${str(p.prefix) ?? ''}${text}${str(p.suffix) ?? ''}`; };
  return <Shell authored={p} trailing={readout()}><input type="range" aria-label={str(p.label)} min={min} max={max} step={typeof p.step === 'number' ? p.step : undefined} value={value() ?? min} ref={el => el.setAttribute('value',String(value() ?? min))} disabled={!active(p)} readOnly={!nameOf(p) || undefined}
    on:input={e => { const n = nameOf(p); if (n) island.setValue(n,Number(e.currentTarget.value),undefined); }}
    class="h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-border disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary" /></Shell>;
}
/** One icon per control: a module-level node would be MOVED between DatePickers (and swapped in during hydration). */
const calendar = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['S','M','T','W','T','F','S'];
const pad = (n: number) => String(n).padStart(2,'0');
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
function monthGrid(y: number, m: number) { const start = -new Date(y,m-1,1).getDay(); const count = Math.ceil((-start + new Date(y,m,0).getDate())/7)*7;
  return Array.from({length:count},(_,index) => { const d = new Date(y,m-1,1+start+index); return { date: iso(d), day:d.getDate(), inMonth:d.getMonth()===m-1 }; }); }
export function DatePicker(p: Props) {
  const island = useIsland(); const [open,setOpen] = createSignal(false); const [view,setView] = createSignal<{y:number;m:number} | null>(null);
  const value = () => choiceValue(p); const today = new Date(); const todayISO = iso(today);
  const shown = () => view() ?? (/^\d{4}-\d{2}-\d{2}$/.test(value() ?? '') ? { y:Number(value()!.slice(0,4)), m:Number(value()!.slice(5,7)) } : { y:today.getFullYear(), m:today.getMonth()+1 });
  const outOfRange = (date: string) => (typeof p.min === 'string' && date < p.min) || (typeof p.max === 'string' && date > p.max);
  const choose = (date: string) => { const n = nameOf(p); if (n) island.setValue(n,date,undefined); setOpen(false); };
  const move = (delta: number) => { const next = shown().m + delta; setView({ y:shown().y + Math.floor((next-1)/12), m:((next-1+12)%12)+1 }); };
  let root!: HTMLDivElement; let trigger!: HTMLButtonElement; let popup: HTMLDivElement | undefined;
  const announce = popupDismiss(open, () => setOpen(false), () => trigger, () => popup);
  return <Shell authored={p}><div ref={root} class="relative"><button ref={trigger} type="button" aria-label={str(p.label)} aria-haspopup="dialog" aria-expanded={open()} disabled={!active(p)} on:click={() => { setView(null); if (!open()) announce(); setOpen(!open()); }}
    class="inline-flex items-center justify-between rounded-md text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 w-40 gap-2 border border-input bg-background px-3 shadow-xs hover:bg-muted/40">
    <span class={join('truncate',value() === null && 'text-muted-foreground')}>{value() ?? 'Pick a date'}</span>{calendar()}</button>
    <Show when={open()}><TrustedOverlay open={open} anchor={() => root}><div ref={popup} role="dialog" aria-label={p.label ? `${p.label} calendar` : 'calendar'} data-theme={root.closest<HTMLElement>('[data-theme]')?.dataset.theme}
      class="rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md" style={{position:'fixed', 'z-index':50, left:`${root.getBoundingClientRect().left}px`, top:`${root.getBoundingClientRect().bottom + 4}px`, width:'256px', '--popover':getComputedStyle(root).getPropertyValue('--popover'), '--popover-foreground':getComputedStyle(root).getPropertyValue('--popover-foreground'), '--border':getComputedStyle(root).getPropertyValue('--border')}}>
      <div class="flex items-center justify-between"><span class="px-1 text-sm font-medium">{MONTHS[shown().m-1]} {shown().y}</span><span class="flex items-center gap-1">
        <button type="button" aria-label="Previous month" on:click={() => move(-1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">‹</button>
        <button type="button" aria-label="Next month" on:click={() => move(1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">›</button>
      </span></div><div class="mt-2 grid grid-cols-7 gap-y-0.5"><For each={DOW}>{d => <span aria-hidden="true" class="flex size-8 items-center justify-center text-[11px] font-medium uppercase text-muted-foreground">{d}</span>}</For>
        <For each={monthGrid(shown().y,shown().m)}>{cell => <button type="button" aria-label={cell.date} aria-pressed={cell.date === value()} disabled={outOfRange(cell.date)} on:click={() => choose(cell.date)}
          class={join('flex size-8 items-center justify-center rounded-sm text-sm tabular-nums transition-colors',cell.date === value() ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground',!cell.inMonth && cell.date !== value() && 'text-muted-foreground/50',cell.date === todayISO && cell.date !== value() && 'font-semibold text-primary',outOfRange(cell.date) && 'cursor-not-allowed opacity-30 hover:bg-transparent')}>{cell.day}</button>}</For></div>
      <Show when={!outOfRange(todayISO)}><div class="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm"><span /><button type="button" on:click={() => choose(todayISO)} class="rounded-sm px-1.5 py-0.5 text-primary transition-colors hover:bg-accent">Today</button></div></Show>
    </div></TrustedOverlay></Show>
  </div></Shell>;
}
/** Native fields keep their tag and authored attributes; only declared bindings are intercepted. */
export function BoundNative(p: Props & { tag: 'input' | 'select' | 'textarea'; bind?: Record<string,string>; children?: JSX.Element }) {
  const island = useIsland(); const { tag,bind,children,...attrs } = p; const name = bind?.value ?? bind?.checked; const value = () => name ? island.value(name) : p.value;
  // The former NativeBoundControl coerces to the bound Value's declared type: an empty choice is null (how
  // `$region is null` means "all"), a number field a number.
  const update = (e: Event) => { if (!name) return; const el = e.currentTarget as HTMLInputElement; const type = island.valueType(name);
    island.setValue(name,bind?.checked ? el.checked : coerceScalarInput(type, el.value),tag === 'select' || bind?.checked ? undefined : { debounce: true }); };
  if (tag === 'select') {
    // The former NativeBoundControl: a query-bound select lists its rows (first column the value, second the
    // label), after an "All" entry when the bound Value may be null; authored options follow.
    const table = () => bind?.options ? island.table(bind.options) : undefined;
    const nullable = () => { const n = bind?.value; return !!n && island.nullable(n); };
    const rows = () => { const t = table(); const [valueCol, labelCol] = t?.columns ?? []; return t && valueCol ? t.rows.map(row => { const v = String(row[valueCol.name] ?? ''); return { value: v, label: labelCol ? String(row[labelCol.name] ?? v) : v }; }) : []; };
    let select!: HTMLSelectElement; createEffect(() => { rows(); select.value = String(value() ?? ''); });
    return <select ref={select} {...attrs as JSX.SelectHTMLAttributes<HTMLSelectElement>} onChange={update}>
      <Show when={table() && nullable()}><option value="" selected={value() == null}>All</option></Show><For each={rows()}>{o => <option value={o.value} selected={o.value === String(value() ?? '')}>{o.label}</option>}</For>{children}</select>;
  }
  if (tag === 'textarea') return <textarea {...attrs as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>} value={String(value() ?? '')} onInput={update}>{children}</textarea>;
  return <input {...attrs as JSX.InputHTMLAttributes<HTMLInputElement>} value={String(value() ?? '')} checked={bind?.checked ? value() === true : undefined} onInput={update} onChange={bind?.checked ? update : undefined} />;
}
