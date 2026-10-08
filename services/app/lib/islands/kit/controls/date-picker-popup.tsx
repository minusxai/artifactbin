/* @jsxImportSource solid-js */
/** Interaction-only calendar. Its trigger and mutation authority stay in controls.tsx. */
import { For, Show, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
export interface DatePickerPopupProps {
  root: HTMLElement; mount: HTMLElement; label?: string; value: string | null;
  min?: unknown; max?: unknown; popupRef(el: HTMLDivElement): void; choose(date: string): void;
}
const join = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
const monthName = new Intl.DateTimeFormat('en', { month: 'long' });
const DOW = ['S','M','T','W','T','F','S'];
const pad = (n: number) => String(n).padStart(2,'0');
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
function monthGrid(y: number, m: number) { const start = -new Date(y,m-1,1).getDay(); const count = Math.ceil((-start + new Date(y,m,0).getDate())/7)*7;
  return Array.from({length:count},(_,index) => { const d = new Date(y,m-1,1+start+index); return { date: iso(d), day:d.getDate(), inMonth:d.getMonth()===m-1 }; }); }
export default function DatePickerPopup(p: DatePickerPopupProps) {
  const [view,setView] = createSignal<{y:number;m:number} | null>(null);
  const today = new Date(), todayISO = iso(today);
  const shown = () => view() ?? (/^\d{4}-\d{2}-\d{2}$/.test(p.value ?? '') ? {y:Number(p.value!.slice(0,4)),m:Number(p.value!.slice(5,7))} : {y:today.getFullYear(),m:today.getMonth()+1});
  const outOfRange = (date:string) => (typeof p.min==='string'&&date<p.min)||(typeof p.max==='string'&&date>p.max);
  const move = (delta:number) => { const next=shown().m+delta;setView({y:shown().y+Math.floor((next-1)/12),m:((next-1+12)%12)+1}); };
  return (
    <Portal mount={p.mount}><div ref={p.popupRef} role="dialog" aria-label={p.label ? `${p.label} calendar` : 'calendar'} data-theme={p.root.closest<HTMLElement>('[data-theme]')?.dataset.theme}
      class="rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md" style={{position:'fixed', 'z-index':50, left:`${p.root.getBoundingClientRect().left}px`, top:`${p.root.getBoundingClientRect().bottom + 4}px`, width:'256px', '--popover':getComputedStyle(p.root).getPropertyValue('--popover'), '--popover-foreground':getComputedStyle(p.root).getPropertyValue('--popover-foreground'), '--border':getComputedStyle(p.root).getPropertyValue('--border')}}>
      <div class="flex items-center justify-between"><span class="px-1 text-sm font-medium">{monthName.format(new Date(shown().y,shown().m-1))} {shown().y}</span><span class="flex items-center gap-1">
        <button type="button" aria-label="Previous month" on:click={() => move(-1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">‹</button>
        <button type="button" aria-label="Next month" on:click={() => move(1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">›</button>
      </span></div><div class="mt-2 grid grid-cols-7 gap-y-0.5"><For each={DOW}>{d => <span aria-hidden="true" class="flex size-8 items-center justify-center text-[11px] font-medium uppercase text-muted-foreground">{d}</span>}</For>
        <For each={monthGrid(shown().y,shown().m)}>{cell => <button type="button" aria-label={cell.date} aria-pressed={cell.date === p.value} disabled={outOfRange(cell.date)} on:click={() => p.choose(cell.date)}
          class={join('flex size-8 items-center justify-center rounded-sm text-sm tabular-nums transition-colors',cell.date === p.value ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground',!cell.inMonth && cell.date !== p.value && 'text-muted-foreground/50',cell.date === todayISO && cell.date !== p.value && 'font-semibold text-primary',outOfRange(cell.date) && 'cursor-not-allowed opacity-30 hover:bg-transparent')}>{cell.day}</button>}</For></div>
      <Show when={!outOfRange(todayISO)}><div class="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm"><span /><button type="button" on:click={() => p.choose(todayISO)} class="rounded-sm px-1.5 py-0.5 text-primary transition-colors hover:bg-accent">Today</button></div></Show>
    </div></Portal>
  );
}
