/* @jsxImportSource solid-js */
/** The data-bound kit. The island context is the sole source of live tables and values. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { useIsland } from '../context';
import { refName, type TableResult } from '@/lib/story/dataflow';
import { aggregateNumber, type NumberAgg } from '@/lib/story/number-aggregation';
import { numberFormatter } from '@/lib/story/number-format';
import { barFraction, cellTint, formatCell, parseColumnSpecs, parseSortSpec, parseTableHeight, resolveColumns, sortRows, type SortSpec } from '@/lib/story/data-table';
import { CHART_SLOT_ATTR, CHART_STATE_ATTR, type DrawnChart } from '@/lib/compiled-page/contract';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import type { RefDataMap } from '@/lib/story/ref-data';

const nameOf = (raw: unknown) => refName(raw) ?? '';
const rootProps = (props: object) => Object.fromEntries(Object.entries(props).filter(([key]) => key === 'id' || key.startsWith('data-')));

export function Number(props: { data: unknown; col?: string; agg?: NumberAgg; prefix?: string; suffix?: string; format?: string; className?: string; id?: string }) {
  const island = useIsland();
  const table = () => island.table(nameOf(props.data));
  const text = () => {
    const rows = table()?.rows;
    if (!rows) return '—';
    const value = aggregateNumber(rows, props.col ?? Object.keys(rows[0] ?? {})[0] ?? '', props.agg ?? 'first');
    return `${props.prefix ?? ''}${globalThis.Number.isFinite(value) ? numberFormatter(props.format)(value) : '—'}${props.suffix ?? ''}`;
  };
  return <span {...rootProps(props)} aria-label={table() ? 'Live number' : 'Number placeholder'} class={props.className}>{text()}</span>;
}

interface SelectProps { label?: string; value?: unknown; options?: unknown; placeholder?: string; className?: string; id?: string; disabled?: boolean; [key: `data-${string}`]: unknown }
export function Select(props: SelectProps) {
  const island = useIsland();
  const options = createMemo(() => {
    const name = nameOf(props.options);
    if (name) {
      const table = island.table(name);
      const [valueCol, labelCol] = table?.columns ?? [];
      return table?.rows.map(row => ({ value: String(row[valueCol?.name ?? ''] ?? ''), label: String(row[labelCol?.name ?? valueCol?.name ?? ''] ?? '') })) ?? [];
    }
    return Array.isArray(props.options) ? props.options.map(option => typeof option === 'object' && option !== null ? { value: String(option.value ?? ''), label: String(option.label ?? option.value ?? '') } : { value: String(option), label: String(option) }) : [];
  });
  const bound = () => [['value', props.value], ['options', props.options]].map(([key, value]) => nameOf(value) ? `${key}:$${nameOf(value)}` : '').filter(Boolean).join(' ');
  const value = () => { const name = nameOf(props.value); return String(name ? island.value(name) ?? '' : props.value ?? ''); };
  return <div {...rootProps(props)} data-mx-bound={bound() || undefined} class={`mx-control relative inline-flex flex-col gap-1.5 align-top${props.className ? ` ${props.className}` : ''}`}>
    <Show when={props.label}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{props.label}</span></span></Show>
    <select aria-label={props.label ?? 'Select value'} value={value()} disabled={props.disabled} onChange={event => { const name = nameOf(props.value); if (name) island.setValue(name, event.currentTarget.value, undefined); }} class="h-9 min-w-36 rounded-md border border-input bg-background px-3 text-sm shadow-xs">
      <option value="">{props.placeholder ?? 'All'}</option><For each={options()}>{option => <option value={option.value}>{option.label}</option>}</For>
    </select>
  </div>;
}

interface DataTableProps { data: unknown; columns?: unknown; sort?: unknown; height?: number | string; sticky?: boolean; className?: string; id?: string; [key: `data-${string}`]: unknown }
const STATIC_ROWS = 50;
export function DataTable(props: DataTableProps) {
  const island = useIsland();
  const table = () => island.table(nameOf(props.data));
  const [sort, setSort] = createSignal<SortSpec | null>(parseSortSpec(props.sort));
  const resolved = createMemo(() => resolveColumns(parseColumnSpecs(props.columns), table()?.columns ?? [], table()?.rows ?? []));
  const ordered = createMemo(() => sortRows(table()?.rows ?? [], sort()));
  const cycle = (col: string) => { const old = sort(); setSort(!old || old.col !== col ? { col, dir: 'asc' } : old.dir === 'asc' ? { col, dir: 'desc' } : null); };
  const count = new Intl.NumberFormat(undefined);
  return <div {...rootProps(props)} data-slot="data-table" aria-label="Data grid" class={`flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm${props.className ? ` ${props.className}` : ''}`}>
    <div class="relative min-h-0 w-full flex-1 overflow-auto" style={{ 'max-height': `${parseTableHeight(props.height)}px` }}>
      <table data-mx-kit-table="" class="w-full border-collapse text-sm">
        <thead class={`bg-card text-left text-muted-foreground${props.sticky === false ? '' : ' sticky top-0 z-10'}`}><tr class="border-b border-border">
          <For each={resolved()}>{column => <th scope="col" aria-label={`Sort by ${column.title}`} aria-sort={sort()?.col === column.col ? sort()?.dir === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => cycle(column.col)} class="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold" style={{ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined }}>{column.title}<Show when={sort()?.col === column.col}><span aria-hidden="true" class="ml-1 opacity-70">{sort()?.dir === 'asc' ? '▲' : '▼'}</span></Show></th>}</For>
        </tr></thead>
        <tbody><Show when={ordered().length} fallback={<tr><td colSpan={Math.max(1, resolved().length)} class="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>}>
          <For each={ordered().slice(0, STATIC_ROWS)}>{(row, index) => <tr data-index={index()} class="border-b border-border/50 transition-colors hover:bg-muted/30"><For each={resolved()}>{column => { const value = row[column.col]; const bar = barFraction(value, column); const tint = cellTint(value, column); return <td class={`relative whitespace-nowrap px-3 py-1.5 align-middle${column.type === 'number' ? ' tabular-nums' : ''}`} style={{ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined, background: tint ?? undefined }}><Show when={bar !== null}><span data-bar="" aria-hidden="true" class="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-25" style={{ width: `${Math.round((bar ?? 0) * 100)}%`, background: typeof column.bar === 'object' && column.bar.color ? column.bar.color : 'var(--chart-1)' }} /></Show><span class="relative">{formatCell(value, column)}</span></td>; }}</For></tr>}</For>
        </Show></tbody>
      </table>
    </div>
    <Show when={table()?.truncated || (table()?.totalRows ?? 0) > (table()?.rows.length ?? 0)}><div class="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"><span aria-label="Row count">{count.format(table()?.rows.length ?? 0)} of {count.format(table()?.totalRows ?? table()?.rows.length ?? 0)} rows</span></div></Show>
  </div>;
}

export interface ChartController { update?(rows: TableResult['rows']): void; dispose(): void }
export interface ChartModule { mountChart(input: { element: HTMLElement; envelope: unknown; rows: TableResult['rows'] }): ChartController }
export interface QuestionProps { data: unknown; viz?: Record<string, unknown>; title?: string; height?: number | string; id?: string; drawn?: DrawnChart; chart?: () => Promise<ChartModule>; refData?: RefDataMap; className?: string }
export function Question(props: QuestionProps) {
  const island = useIsland();
  const name = nameOf(props.data);
  const table = () => island.tableSnapshot(name);
  const [state, setState] = createSignal(props.drawn ? 'ready' : 'pending');
  let slot!: HTMLDivElement;
  let controller: ChartController | undefined;
  let started = false;
  const load = async () => {
    if (started) return;
    started = true;
    const result = questionEnvelope(props.viz ?? {}, table()?.columns ?? [], props.refData);
    if ('error' in result) { setState('pending'); return; }
    if (!props.chart) return; // The runtime track supplies its lazy chart loader.
    const module = await props.chart();
    controller = module.mountChart({ element: slot, envelope: result, rows: table()?.rows ?? [] });
    setState('live');
  };
  onMount(() => { if (props.drawn?.svg) slot.innerHTML = props.drawn.svg; });
  createEffect(on(table, current => { if (current && props.drawn && current.rows !== undefined && state() === 'ready' && !started) void load(); }, { defer: true }));
  onCleanup(() => controller?.dispose());
  return <div {...rootProps(props)} class={`flex h-full w-full flex-col${props.className ? ` ${props.className}` : ''}`} style={{ height: props.height ? typeof props.height === 'number' ? `${props.height}px` : props.height : undefined }} aria-label="Question embed body">
    <Show when={props.title}><div class="border-b border-border px-3 py-2 font-mono text-sm font-medium">{props.title}</div></Show>
    <div class="flex min-h-0 flex-1 flex-col"><div ref={slot} {...{ [CHART_SLOT_ATTR]: props.id ?? '' }} {...{ [CHART_STATE_ATTR]: state() }} onPointerEnter={() => void load()} onClick={() => void load()} /></div>
  </div>;
}
