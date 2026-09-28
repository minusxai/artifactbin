/* @jsxImportSource solid-js */
/** The data-bound kit. The island context is the sole source of live tables and values. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { useIsland } from '../context';
import { refName } from '@/lib/story/dataflow';
import { aggregateNumber, type NumberAgg } from '@/lib/story/number-aggregation';
import { numberFormatter } from '@/lib/story/number-format';
import { barFraction, cellTint, formatCell, gridGeometry, parseColumnSpecs, parseSortSpec, parseTableHeight, resolveColumns, sortRows, type SortSpec } from '@/lib/story/data-table';
import { keyedRowsError } from '@/lib/story/repeat-identity';
import { personFaceBackground, personInitial } from '@/lib/person-face';
import type { PersonCard } from '@artifactbin/contracts';
import type { Row } from '@/lib/story/dataflow';
import { CHART_SLOT_ATTR, CHART_STATE_ATTR, type DrawnChart } from '@/lib/compiled-page/contract';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { IslandChart, IslandChartModule } from '../contract';

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
  return <span {...rootProps(props)} aria-busy="false" class={props.className}><span aria-label={table() ? 'Live number' : 'Number placeholder'}>{text()}</span></span>;
}

interface SelectProps { label?: string; value?: unknown; options?: unknown; placeholder?: string; className?: string; id?: string; disabled?: boolean; [key: `data-${string}`]: unknown }
export function Select(props: SelectProps) {
  const island = useIsland();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
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
  const entries = () => [{ value: '', label: props.placeholder ?? 'All' }, ...options()];
  const filtered = () => entries().filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()));
  const selected = () => entries().find(option => option.value === value())?.label ?? value();
  const choose = (next: string) => { const name = nameOf(props.value); if (name) island.setValue(name, next || null, undefined); setOpen(false); setQuery(''); };
  return <div {...rootProps(props)} data-mx-bound={bound() || undefined} class={`mx-control relative inline-flex flex-col gap-1.5 align-top${props.className ? ` ${props.className}` : ''}`}>
    <Show when={props.label}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{props.label}</span></span></Show>
    <div class="relative min-w-0"><button type="button" aria-label={props.label} aria-haspopup="listbox" aria-expanded={open()} disabled={props.disabled} onClick={() => setOpen(!open())} class="inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40"><span class={`truncate${value() ? '' : ' text-muted-foreground'}`}>{selected()}</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button></div>
    <Show when={open()}><Portal><div class="rounded-md border border-border bg-popover text-popover-foreground shadow-md" style={{ position: 'fixed', 'z-index': 50 }}><div class="border-b border-border p-1.5"><input type="text" role="searchbox" aria-label={props.label ? `Search ${props.label}` : 'Search options'} placeholder="Type to filter…" value={query()} onInput={event => setQuery(event.currentTarget.value)} class="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></div><div role="listbox" aria-label={props.label} class="max-h-56 overflow-y-auto p-1"><For each={filtered()}>{option => <button type="button" role="option" aria-selected={option.value === value()} aria-label={option.label} onClick={() => choose(option.value)} class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm"><span class="truncate">{option.label}</span><Show when={option.value === value()}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg></Show></button>}</For></div></div></Portal></Show>
  </div>;
}

interface ColumnTemplate { col: string; props: Record<string, unknown>; nodes: unknown[]; path: string }
interface DataTableProps { data: unknown; columns?: unknown; sort?: unknown; height?: number | string; sticky?: boolean; className?: string; id?: string; rowKey?: string; templates?: ColumnTemplate[]; renderCell?: (template: ColumnTemplate, row: Row, index: number) => import('solid-js').JSX.Element; resolveSrc?: (url: string) => string | null; [key: `data-${string}`]: unknown }
const STATIC_ROWS = 50;
const ROW_H = 33;
function TimestampCell(props: { value: string }) {
  const [label, setLabel] = createSignal(props.value);
  onMount(() => { const date = new Date(props.value); setLabel(globalThis.Number.isNaN(date.getTime()) ? props.value : date.toLocaleString()); });
  return <time dateTime={props.value}>{label()}</time>;
}
function UserCell(props: { id: string; card?: PersonCard }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const image = () => props.card?.image && failed() !== props.card.image ? props.card.image : null;
  return <span data-slot="user" class="inline-flex items-center gap-1.5 align-middle"><span data-slot="avatar" data-size="default" data-unknown={props.card ? undefined : ''} aria-hidden="true" class="group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 inline-flex shrink-0 align-middle size-5" style={props.card ? { 'background-color': personFaceBackground(props.id) } : undefined}><span data-slot="avatar-fallback" class={`flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs${props.card ? ' bg-transparent font-medium text-white' : ''} text-[10px]`}>{props.card ? personInitial(props.card.name) : '?'}</span><Show when={image()}>{src => <img data-slot="avatar-image" class="absolute inset-0 aspect-square size-full object-cover" src={src()} alt="" aria-hidden="true" onError={() => setFailed(src())} />}</Show></span>{props.card?.handle ? <a data-slot="user-handle" href={`/@${props.card.handle}`} target="_top" rel="noopener" class="underline-offset-2 hover:underline">@{props.card.handle}</a> : <span data-slot="user-handle" data-unknown={props.card ? undefined : ''} class={props.card ? '' : 'text-muted-foreground'}>{props.card?.name ?? 'Unknown person'}</span>}</span>;
}
export function DataTable(props: DataTableProps) {
  const island = useIsland();
  const table = () => island.table(nameOf(props.data));
  const [sort, setSort] = createSignal<SortSpec | null>(parseSortSpec(props.sort));
  const [extra, setExtra] = createSignal<Row[]>([]);
  const [replaced, setReplaced] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [virtual, setVirtual] = createSignal(false);
  const [measured, setMeasured] = createSignal<number[] | null>(null);
  let scroll!: HTMLDivElement;
  let request = 0;
  let askedAt = -1;
  const remote = () => !!table()?.truncated && !!island.store();
  const shown = createMemo(() => replaced() && extra().length ? extra() : [...(table()?.rows ?? []), ...extra()]);
  const resolved = createMemo(() => resolveColumns(props.templates?.length ? parseColumnSpecs(props.templates.map(t => t.props)) : parseColumnSpecs(props.columns), table()?.columns ?? [], shown()));
  const ordered = createMemo(() => remote() ? shown() : sortRows(shown(), sort()));
  const readWindow = (offset: number, next: SortSpec | null, replace: boolean) => {
    const name = nameOf(props.data), base = table(), store = island.store();
    if (!name || !base || !store) return;
    const seq = ++request;
    setLoading(true);
    if (replace) { setExtra([]); setReplaced(true); }
    void store.fetchPage(name, { offset, limit: 500, sort: next ?? undefined }).then(win => {
      if (seq !== request || table() !== base) return;
      setExtra(rows => replace ? win.rows : [...rows, ...win.rows]);
      setLoading(false);
    }, () => { if (seq === request) setLoading(false); });
  };
  createEffect(on(table, () => { ++request; setExtra([]); setReplaced(false); setLoading(false); askedAt = -1; }, { defer: true }));
  const cycle = (col: string) => { const old = sort(); const next: SortSpec | null = !old || old.col !== col ? { col, dir: 'asc' } : old.dir === 'asc' ? { col, dir: 'desc' } : null; setSort(next); if (remote()) readWindow(0, next, true); };
  const geometry = createMemo(() => gridGeometry(resolved(), measured()));
  const rowGrid = () => virtual() ? `display:grid;grid-template-columns:${geometry().template};width:100%${geometry().minWidth ? `;min-width:${geometry().minWidth}px` : ''}` : undefined;
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({ getScrollElement: () => scroll, get count() { return ordered().length; }, estimateSize: () => ROW_H, overscan: 12, get enabled() { return virtual(); }, initialOffset: () => scroll?.scrollTop ?? 0 });
  const visible = () => {
    if (!virtual()) return ordered().slice(0, STATIC_ROWS).map((_, index) => ({ index, start: null }));
    const items = virtualizer.getVirtualItems();
    if (items.length) return items.map(v => ({ index: v.index, start: v.start }));
    // The observer may report its first rect after the measured static table is removed.
    const first = Math.max(0, Math.floor((scroll?.scrollTop ?? 0) / ROW_H) - 12);
    return Array.from({ length: Math.min(ordered().length - first, Math.ceil((scroll?.clientHeight ?? 0) / ROW_H) + 24) }, (_, offset) => ({ index: first + offset, start: (first + offset) * ROW_H }));
  };
  onMount(() => { if (scroll?.clientHeight && ordered().length > STATIC_ROWS) { setMeasured([...scroll.querySelectorAll('thead th')].map(th => th.getBoundingClientRect().width)); setVirtual(true); } });
  const onScroll = () => { if (!scroll || !remote() || loading()) return; if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - ROW_H * 6 && askedAt !== shown().length) { askedAt = shown().length; readWindow(shown().length, sort(), false); } };
  const cell = (value: unknown, column: ReturnType<typeof resolved>[number], row: Row, index: number) => {
    const template = props.templates?.find(t => t.col === column.col);
    if (template?.nodes.length && props.renderCell) return props.renderCell(template, row, index);
    if (column.kind === 'image' && typeof value === 'string' && /^https?:\/\//i.test(value)) { const src = props.resolveSrc?.(value); if (src) return <img src={src} alt="" loading="lazy" class="inline-block max-h-8 w-auto align-middle" />; }
    if (column.type === 'timestamp' && typeof value === 'string') return <TimestampCell value={value} />;
    if (column.type === 'user' && typeof value === 'string') return <UserCell id={value} card={island.people()[value]} />;
    return formatCell(value, column);
  };
  const count = new Intl.NumberFormat(undefined);
  const identityError = () => props.rowKey ? keyedRowsError(shown(), props.rowKey) : null;
  if (identityError()) return <div role="alert">{identityError()}</div>;
  return <div {...rootProps(props)} data-slot="data-table" aria-label="Data grid" class={`flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm${props.className ? ` ${props.className}` : ''}`}>
    <div ref={scroll} onScroll={onScroll} class="relative min-h-0 w-full flex-1 overflow-auto" style={{ 'max-height': `${parseTableHeight(props.height)}px` }}>
      <table data-mx-kit-table="" class="w-full border-collapse text-sm" style={virtual() ? 'display:block' : undefined}>
        <thead class={`bg-card text-left text-muted-foreground${props.sticky === false ? '' : ' sticky top-0 z-10'}`} style={virtual() ? 'display:block' : undefined}><tr class="border-b border-border" style={rowGrid()}>
          <For each={resolved()}>{column => <th scope="col" aria-label={`Sort by ${column.title}`} aria-sort={sort()?.col === column.col ? sort()?.dir === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => cycle(column.col)} class="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold" style={{ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined }}>{column.title}<Show when={sort()?.col === column.col}><span aria-hidden="true" class="ml-1 opacity-70">{sort()?.dir === 'asc' ? '▲' : '▼'}</span></Show></th>}</For>
        </tr></thead>
        <tbody style={virtual() ? `display:block;height:${virtualizer.getTotalSize() || ordered().length * ROW_H}px;position:relative` : undefined}><Show when={ordered().length} fallback={<tr><td colSpan={Math.max(1, resolved().length)} class="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>}>
          <For each={visible()}>{item => <tr ref={virtual() ? virtualizer.measureElement : undefined} data-index={item.index} class="border-b border-border/50 transition-colors hover:bg-muted/30" style={item.start === null ? undefined : `${rowGrid()};position:absolute;top:0;left:0;transform:translateY(${item.start}px)`}><For each={resolved()}>{column => { const row = ordered()[item.index]!; const value = row[column.col]; const bar = barFraction(value, column); const tint = cellTint(value, column); return <td class={`relative whitespace-nowrap px-3 py-1.5 align-middle${column.type === 'number' ? ' tabular-nums' : ''}`} style={{ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined, background: tint ?? undefined }}><Show when={bar !== null}><span data-bar="" aria-hidden="true" class="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-25" style={{ width: `${Math.round((bar ?? 0) * 100)}%`, background: typeof column.bar === 'object' && column.bar.color ? column.bar.color : 'var(--chart-1)' }} /></Show><span class="relative">{cell(value, column, row, item.index)}</span></td>; }}</For></tr>}</For>
        </Show></tbody>
      </table>
    </div>
    <Show when={table()?.truncated || loading() || (table()?.totalRows ?? 0) > shown().length}><div class="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"><span aria-label="Row count">{loading() ? 'loading rows…' : `${count.format(shown().length)} of ${count.format(table()?.totalRows ?? shown().length)} rows`}</span><Show when={remote() && !loading()}><button type="button" aria-label="Load more rows" onClick={() => readWindow(shown().length, sort(), false)} class="cursor-pointer font-medium underline-offset-2 hover:underline">load more</button></Show></div></Show>
  </div>;
}

export interface QuestionProps { data: unknown; viz?: Record<string, unknown>; title?: string; height?: number | string; id?: string; drawn?: DrawnChart; chart?: () => Promise<IslandChartModule>; refData?: RefDataMap; className?: string }
export function Question(props: QuestionProps) {
  const island = useIsland();
  const name = nameOf(props.data);
  const table = () => island.tableSnapshot(name);
  const [state, setState] = createSignal(props.drawn ? 'ready' : 'pending');
  let slot!: HTMLDivElement;
  let controller: IslandChart | undefined;
  let started = false;
  let disposed = false;
  const load = async () => {
    if (started) return;
    started = true;
    const result = questionEnvelope(props.viz ?? {}, table()?.columns ?? [], props.refData);
    if ('error' in result) { setState('pending'); return; }
    const module = await (props.chart ?? island.loadChart)();
    if (disposed) return;
    controller = module.mountChart({ element: slot, envelope: result, rows: table()?.rows ?? [] });
    setState('live');
  };
  onMount(() => { if (props.drawn?.svg) slot.innerHTML = props.drawn.svg; });
  createEffect(on(table, current => { if (current && props.drawn && current.rows !== undefined && state() === 'ready' && !started) void load(); }, { defer: true }));
  onCleanup(() => { disposed = true; controller?.destroy(); });
  return <div {...rootProps(props)} class={`flex h-full w-full flex-col${props.className ? ` ${props.className}` : ''}`} style={{ height: props.height ? typeof props.height === 'number' ? `${props.height}px` : props.height : undefined }} aria-label="Question embed body">
    <Show when={props.title}><div class="border-b border-border px-3 py-2 font-mono text-sm font-medium">{props.title}</div></Show>
    <div class="flex min-h-0 flex-1 flex-col"><div ref={slot} {...{ [CHART_SLOT_ATTR]: props.id ?? '' }} {...{ [CHART_STATE_ATTR]: state() }} onPointerEnter={() => void load()} onClick={() => void load()} /></div>
  </div>;
}
