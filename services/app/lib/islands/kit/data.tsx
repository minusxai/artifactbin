/* @jsxImportSource solid-js */
/**
 * The data-bound kit. The island context is the sole source of live tables and values.
 *
 * PARITY: each widget renders the DOM today's reader renders (the runtime adapters in
 * lib/story-runtime/StoryRuntimeApp around components/kit/data-table, controls' SelectControl and
 * views/story/QuestionEmbed), which scripts/gate-compiled-parity.mjs compares attribute by
 * attribute. Two consequences shape this file:
 *  - An absent attribute is spread in (`attr()`), never bound to `undefined`: Solid's server
 *    renderer writes `class=""`/`style=""` for an undefined binding, which today's DOM does not have.
 *  - Inline styles are strings in the browser's own serialization (`max-height: 300px;`) wherever
 *    today's React renders the element in the browser, and in the server's (`width:100%`) where
 *    today's element is the server-rendered adapter wrapper. Those wrapper strings are spread in as
 *    `attr:style` (a raw attribute: hydration leaves it as served), because a `style` binding — and
 *    the JSX `attr:style` form, which the compiler turns back into one — re-sets it through the
 *    CSSOM (`width: 100%;`).
 */
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { isServer } from 'solid-js/web';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { useIsland } from '../context';
import { deferEngine } from '../defer-engine';
import { TrustedOverlay } from './trusted-overlay';
import { refName, type TableResult } from '@/lib/story/dataflow';
import { aggregateNumber, type NumberAgg } from '@/lib/story/number-aggregation';
import { numberFormatter } from '@/lib/story/number-format';
import { barFraction, cellTint, formatCell, gridGeometry, parseColumnSpecs, parseSortSpec, parseTableHeight, resolveColumns, sortRows, type SortSpec } from '@/lib/story/data-table';
import { commentMetadata, keyedRowsError } from '@/lib/story/repeat-identity';
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { personFaceBackground, personInitial } from '@/lib/person-face';
import type { PersonCard } from '@artifactbin/contracts';
import type { Row } from '@/lib/story/dataflow';
import { CHART_SLOT_ATTR, CHART_STATE_ATTR, type DrawnChart } from '@/lib/compiled-page/contract';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { IslandChart, IslandChartModule } from '../contract';
import { DRAWING_CLASS, drawingIsCurrent } from '../chart';
import { rowsDigest } from '../digest';

const nameOf = (raw: unknown) => refName(raw) ?? '';
/** The authored identity today's adapters put on their outer element (StoryRuntimeApp runtimeTargetIdentity): the id and the compiler's `data-*` stamps, never the chart slot marker. */
const rootProps = (props: object) => Object.fromEntries(Object.entries(props).filter(([key]) => (key === 'id' || key.startsWith('data-')) && key !== CHART_SLOT_ATTR));
/** An attribute that is present only when it has a value. */
const attr = (name: string, value: string | null | undefined | false): Record<string, string> => (value || value === '' ? { [name]: value } : {});
/** Declarations in the browser's `style` serialization (`name: value;`, space-joined); empty values dropped. */
const css = (decls: Record<string, string | null | undefined>): string =>
  Object.entries(decls).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v};`).join(' ');

export function Number(props: { data: unknown; col?: string; agg?: NumberAgg; prefix?: string; suffix?: string; format?: string; className?: string; id?: string }) {
  const island = useIsland();
  const table = () => island.table(nameOf(props.data));
  const text = () => {
    const rows = table()?.rows;
    if (!rows) return '—';
    const value = aggregateNumber(rows, props.col ?? Object.keys(rows[0] ?? {})[0] ?? '', props.agg ?? 'first');
    return `${props.prefix ?? ''}${globalThis.Number.isFinite(value) ? numberFormatter(props.format)(value) : '—'}${props.suffix ?? ''}`;
  };
  // Today's NumberAdapter: the figure stays while its query re-runs, and the wrapper says so.
  const busy = () => !!nameOf(props.data) && island.pending(nameOf(props.data));
  return <span {...rootProps(props)} aria-busy={busy() ? 'true' : 'false'} {...attr('class', busy() ? 'mx-busy-inline' : props.className)}><span aria-label={table() ? 'Live number' : 'Number placeholder'}>{text()}</span></span>;
}

interface SelectProps { label?: string; value?: unknown; options?: unknown; placeholder?: string; className?: string; id?: string; disabled?: boolean; [key: `data-${string}`]: unknown }
const selectClass = 'mx-control relative inline-flex flex-col gap-1.5 align-top';
/** Today's trigger classes in SelectControl's own order (`cn(base, field appearance)`). */
const SELECT_TRIGGER = 'inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40';
const selectJoin = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
const CHEVRON = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const CHECK = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
export function Select(p: SelectProps) {
  const island = useIsland(); const [open,setOpen] = createSignal(false); const [query,setQuery] = createSignal(''); const [highlight,setHighlight] = createSignal(-1);
  const valueName = () => nameOf(p.value);
  const optionsName = () => nameOf(p.options);
  const active = () => !!valueName() && Object.hasOwn(island.values(), valueName()) && p.disabled !== true;
  const current = () => valueName() ? island.value(valueName()) == null ? null : String(island.value(valueName())) : typeof p.value === 'string' ? p.value : typeof p.value === 'number' ? String(p.value) : null;
  const options = createMemo(() => {
    const name = optionsName();
    if (name) {
      const table = island.table(name);
      const [valueCol, labelCol] = table?.columns ?? [];
      return table && valueCol ? table.rows.map(row => ({ value: String(row[valueCol.name] ?? ''), label: String(row[labelCol?.name ?? valueCol.name] ?? row[valueCol.name] ?? '') })) : [];
    }
    return Array.isArray(p.options) ? p.options.map(option => typeof option === 'object' && option !== null ? { value: String(option.value ?? ''), label: String(option.label ?? option.value ?? '') } : { value: String(option), label: String(option) }) : [];
  });
  const label = () => current() === null ? p.placeholder ?? 'All' : options().find(o => o.value === current())?.label ?? current();
  const entries = () => [...(valueName() ? [{ value: null, label: p.placeholder ?? 'All' }] : []), ...options()];
  const filtered = () => entries().filter(o => o.label.toLowerCase().includes(query().toLowerCase()));
  const choose = (value: string | null) => { if (valueName()) island.setValue(valueName(),value,undefined); setOpen(false); setQuery(''); };
  let root!: HTMLDivElement;
  // No `data-mx-bound` stamp: that marks today's STATIC render of a bound control; the live SelectAdapter never writes it.
  return <div {...rootProps(p)} class={selectJoin(selectClass,p.className)}>
    <Show when={p.label}><span class="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>{p.label}</span></span></Show>
    <div ref={root} class="relative min-w-0"><button type="button" aria-label={p.label} aria-haspopup="listbox" aria-expanded={open()} disabled={!active()} on:click={() => setOpen(!open())}
      class={SELECT_TRIGGER}>
      <span class={selectJoin('truncate',current() === null && 'text-muted-foreground')}>{label()}</span><CHEVRON /></button>
      <TrustedOverlay open={open}><Show when={open()}><div class="rounded-md border border-border bg-popover text-popover-foreground shadow-md" style={{position:'fixed', 'z-index':50, left:`${root.getBoundingClientRect().left}px`, top:`${root.getBoundingClientRect().bottom + 4}px`, width:`${Math.max(root.getBoundingClientRect().width,200)}px`}}>
        <div class="border-b border-border p-1.5"><input type="text" role="searchbox" aria-label={p.label ? `Search ${p.label}` : 'Search options'} placeholder="Type to filter…" value={query()}
          on:input={e => { const q = e.currentTarget.value; setQuery(q); setHighlight(filtered().length ? 0 : -1); }}
          class="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
        <div role="listbox" aria-label={p.label} class="max-h-56 overflow-y-auto p-1"><For each={filtered()}>{(o,i) => <button type="button" role="option" aria-label={o.label} aria-selected={o.value === current()}
          on:click={() => choose(o.value)} on:mouseenter={() => setHighlight(i())}
          class={selectJoin('flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm',i() === highlight() && 'bg-accent text-accent-foreground',o.value === null && o.value !== current() && 'text-muted-foreground')}>
          <span class="truncate">{o.label}</span><Show when={o.value === current()}><CHECK /></Show></button>}</For>
          <Show when={filtered().length === 0}><div role="status" class="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div></Show></div>
      </div></Show></TrustedOverlay>
    </div></div>;
}


/**
 * A `<Column>` of the table. The compiler passes `{ col, id, path }` (the column's author id and AST
 * path, which today's header cell carries) beside the parsed `columns`; the interpreter's shape also
 * carries the column's `props` and its cell template `nodes`.
 */
interface ColumnTemplate { col: string; id?: string; path?: string; props?: Record<string, unknown>; nodes?: unknown[] }
interface DataTableProps { data: unknown; columns?: unknown; sort?: unknown; height?: number | string; sticky?: boolean; className?: string; id?: string; rowKey?: string; inGridItem?: boolean; templates?: ColumnTemplate[]; renderCell?: (template: ColumnTemplate, row: Row, index: number) => import('solid-js').JSX.Element; resolveSrc?: (url: string) => string | null; [key: `data-${string}`]: unknown }
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
  return <span data-slot="user" class="inline-flex items-center gap-1.5 align-middle"><span data-slot="avatar" data-size="default" {...attr('data-unknown', props.card ? undefined : '')} aria-hidden="true" class="group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 inline-flex shrink-0 align-middle size-5" {...attr('style', props.card ? css({ 'background-color': personFaceBackground(props.id) }) : undefined)}><span data-slot="avatar-fallback" class={`flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs${props.card ? ' bg-transparent font-medium text-white' : ''} text-[10px]`}>{props.card ? personInitial(props.card.name) : '?'}</span><Show when={image()}>{src => <img data-slot="avatar-image" class="absolute inset-0 aspect-square size-full object-cover" src={src()} alt="" aria-hidden="true" onError={() => setFailed(src())} />}</Show></span>{props.card?.handle ? <a data-slot="user-handle" href={`/@${props.card.handle}`} target="_top" rel="noopener" class="underline-offset-2 hover:underline">@{props.card.handle}</a> : <span data-slot="user-handle" {...attr('data-unknown', props.card ? undefined : '')} {...attr('class', props.card ? undefined : 'text-muted-foreground')}>{props.card?.name ?? 'Unknown person'}</span>}</span>;
}
/** A row's React key in today's table (components/kit/data-table rowIdentity): the virtualizer's item key. */
const rowIdentity = (row: Row | undefined, key: string | undefined, index: number): string => {
  const value = key && row ? row[key] : undefined;
  return value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number') ? `index:${index}` : `${typeof value}:${String(value)}`;
};
/** Where the pending lockup spins (QuestionEmbed `waiting`, DataTableAdapter's pending state). */
const SPINNER = 'size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none';
const LOCKUP_LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground';

/**
 * `<DataTable>` — today's DataTableAdapter (its `aria-label="DataTable embed"` wrapper, the
 * placeholder while the table has no result) around today's kit DataTable: a plain table of the
 * first rows as served, then, once mounted with a measured height, the same box as a virtual window.
 */
export function DataTable(props: DataTableProps) {
  const island = useIsland();
  const name = () => nameOf(props.data);
  const table = () => island.table(name());
  const busy = () => !!name() && island.pending(name());
  const wrapper = () => (props.inGridItem ? 'width:100%;height:100%' : 'width:100%');
  return <Show when={table()} fallback={
    <div {...rootProps(props)} aria-label="DataTable embed" class="flex w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border p-4 text-sm text-muted-foreground" {...attr('attr:style', wrapper())}>
      <Switch fallback={`data unavailable — "$${name()}" has no rows yet`}>
        <Match when={busy()}><span aria-hidden="true" class={SPINNER} /><span class={LOCKUP_LABEL}>loading data…</span></Match>
        <Match when={!name()}>{'data unavailable — bind a declared table with data="$name"'}</Match>
        <Match when={island.error(name())}>{error => `query "${name()}" failed: ${error()}`}</Match>
      </Switch>
    </div>
  }>
    {/* Cell sessions show saving on an editable table; only a read-only table dims while it refreshes. */}
    <div {...rootProps(props)} aria-label="DataTable embed" aria-busy={busy() ? 'true' : 'false'} {...attr('class', busy() && !props.templates?.length ? 'mx-busy' : undefined)} {...attr('attr:style', wrapper())}>
      <DataGrid {...props} table={table()!} />
    </div>
  </Show>;
}

function DataGrid(props: DataTableProps & { table: TableResult }) {
  const island = useIsland();
  const table = () => props.table;
  const owner = typeof props.id === 'string' ? props.id : undefined;
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
  // Today's adapter hands the kit `templates` (whose props ARE the column spec) or the parsed `columns`.
  const spec = () => props.templates?.length && props.templates.every(t => t.props) ? parseColumnSpecs(props.templates.map(t => t.props)) : parseColumnSpecs(props.columns);
  const resolved = createMemo(() => resolveColumns(spec(), table()?.columns ?? [], shown()));
  const ordered = createMemo(() => remote() ? shown() : sortRows(shown(), sort()));
  const templateOf = (col: string) => props.templates?.find(t => t.col === col);
  const readWindow = (offset: number, next: SortSpec | null, replace: boolean) => {
    const base = table(), store = island.store();
    if (!name() || !base || !store) return;
    const seq = ++request;
    setLoading(true);
    if (replace) { setExtra([]); setReplaced(true); }
    void store.fetchPage(name(), { offset, limit: 500, sort: next ?? undefined }).then(win => {
      if (seq !== request || table() !== base) return;
      setExtra(rows => replace ? win.rows : [...rows, ...win.rows]);
      setLoading(false);
    }, () => { if (seq === request) setLoading(false); });
  };
  const name = () => nameOf(props.data);
  createEffect(on(table, () => { ++request; setExtra([]); setReplaced(false); setLoading(false); askedAt = -1; }, { defer: true }));
  const cycle = (col: string) => { const old = sort(); const next: SortSpec | null = !old || old.col !== col ? { col, dir: 'asc' } : old.dir === 'asc' ? { col, dir: 'desc' } : null; setSort(next); if (remote()) readWindow(0, next, true); };
  const geometry = createMemo(() => gridGeometry(resolved(), measured()));
  // In the virtual regime the header row and every body row are the same CSS grid (today's rowGrid).
  const rowGrid = () => ({ display: 'grid', 'grid-template-columns': geometry().template, width: '100%', 'min-width': geometry().minWidth ? `${geometry().minWidth}px` : undefined });
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({ getScrollElement: () => scroll, get count() { return ordered().length; }, getItemKey: (index) => rowIdentity(ordered()[index], props.rowKey, index), estimateSize: () => ROW_H, overscan: 12, get enabled() { return virtual(); }, initialOffset: () => scroll?.scrollTop ?? 0 });
  const visible = createMemo(() => {
    if (!virtual()) return ordered().slice(0, STATIC_ROWS).map((row, index) => ({ row, index, start: null as number | null }));
    const items = virtualizer.getVirtualItems();
    if (items.length) return items.map(v => ({ row: ordered()[v.index]!, index: v.index, start: v.start as number | null }));
    // The observer may report its first rect after the switch; keep the window around the offset visible.
    const first = Math.max(0, Math.floor((scroll?.scrollTop ?? 0) / ROW_H) - 12);
    return Array.from({ length: Math.max(0, Math.min(ordered().length - first, Math.ceil((scroll?.clientHeight ?? 0) / ROW_H) + 24)) }, (_, offset) => ({ row: ordered()[first + offset]!, index: first + offset, start: (first + offset) * ROW_H as number | null }));
  });
  // Rows are keyed by the row object, so the rows served with the page are the rows of the virtual window.
  const placed = createMemo(() => new Map(visible().map(v => [v.row, v])));
  // Today's switch: virtual once mounted with a measured height, whatever the row count; the header
  // widths are read while the served table's auto layout is still on screen.
  onMount(() => { if (scroll?.clientHeight) { setMeasured([...scroll.querySelectorAll('thead th')].map(th => th.getBoundingClientRect().width)); setVirtual(true); } });
  const onScroll = () => { if (!scroll || !remote() || loading()) return; if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - ROW_H * 6 && askedAt !== shown().length) { askedAt = shown().length; readWindow(shown().length, sort(), false); } };
  const cell = (value: unknown, column: ReturnType<typeof resolved>[number], row: Row, index: number) => {
    const template = templateOf(column.col);
    if (template?.nodes?.length && props.renderCell) return props.renderCell(template, row, index);
    if (column.kind === 'image' && typeof value === 'string' && /^https?:\/\//i.test(value)) { const src = props.resolveSrc?.(value); if (src) return <img src={src} alt="" loading="lazy" class="inline-block max-h-8 w-auto align-middle" />; }
    if (column.type === 'user' && typeof value === 'string') return <UserCell id={value} card={island.people()[value]} />;
    if (column.type === 'timestamp' && typeof value === 'string') return <TimestampCell value={value} />;
    return formatCell(value, column);
  };
  const rowMeta = (row: Row, columnKey?: string) => props.rowKey && owner ? commentMetadata(owner, { kind: 'table', rowKey: row[props.rowKey] as string | number, ...(columnKey ? { columnKey } : {}) }) : {};
  const count = new Intl.NumberFormat(undefined);
  const identityError = () => props.rowKey ? keyedRowsError(shown(), props.rowKey) : null;
  return <Show when={!identityError()} fallback={<div role="alert">{identityError()}</div>}><div data-slot="data-table" aria-label="Data grid" class="flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm">
    <div ref={scroll} onScroll={onScroll} class="relative min-h-0 w-full flex-1 overflow-auto" style={css({ 'max-height': `${parseTableHeight(props.height)}px` })}>
      <table data-mx-kit-table="" class="w-full border-collapse text-sm" {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}>
        <thead class={`bg-card text-left text-muted-foreground${props.sticky === false ? '' : ' sticky top-0 z-10'}`} {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}><tr class="border-b border-border" {...attr('style', virtual() ? css(rowGrid()) : undefined)}>
          <For each={resolved()}>{column => <th {...attr('id', templateOf(column.col)?.id ?? (typeof templateOf(column.col)?.props?.id === 'string' ? templateOf(column.col)!.props!.id as string : undefined))} {...attr('data-mx-ast', templateOf(column.col)?.path)} scope="col" aria-label={`Sort by ${column.title}`} aria-sort={sort()?.col === column.col ? sort()?.dir === 'asc' ? 'ascending' : 'descending' : 'none'} {...attr('title', column.type === 'string' && !(table()?.columns ?? []).some(k => k.name === column.col) ? `"${column.col}" is not a column of this table` : undefined)} onClick={() => cycle(column.col)} class="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold" style={css({ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined })}>{column.title}<Show when={sort()?.col === column.col}><span aria-hidden="true" class="ml-1 opacity-70">{sort()?.dir === 'asc' ? '▲' : '▼'}</span></Show></th>}</For>
        </tr></thead>
        <tbody {...attr('style', virtual() ? css({ display: 'block', height: `${virtualizer.getTotalSize()}px`, position: 'relative' }) : undefined)}><Show when={ordered().length} fallback={<tr {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}><td colSpan={Math.max(1, resolved().length)} class="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>}>
          <For each={visible().map(v => v.row)}>{row => {
            const at = () => placed().get(row);
            const index = () => at()?.index ?? 0;
            let el!: HTMLTableRowElement;
            createEffect(() => { if (virtual() && at()) virtualizer.measureElement(el); });
            return <tr ref={el} {...rowMeta(row)} data-index={index()} class="border-b border-border/50 transition-colors hover:bg-muted/30" {...attr('style', at()?.start == null ? undefined : css({ ...rowGrid(), position: 'absolute', top: '0px', left: '0px', transform: `translateY(${at()!.start}px)` }))}><For each={resolved()}>{column => { const value = row[column.col]; const bar = barFraction(value, column); const tint = cellTint(value, column); return <td {...rowMeta(row, column.col)} class={`relative whitespace-nowrap px-3 py-1.5 align-middle${column.type === 'number' ? ' tabular-nums' : ''}`} style={css({ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined, background: tint ?? undefined })}><Show when={bar !== null}><span data-bar="" aria-hidden="true" class="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-25" style={css({ width: `${Math.round((bar ?? 0) * 100)}%`, background: typeof column.bar === 'object' && column.bar.color ? column.bar.color : 'var(--chart-1)' })} /></Show><span class="relative">{cell(value, column, row, index())}</span></td>; }}</For></tr>;
          }}</For>
        </Show></tbody>
      </table>
    </div>
    <Show when={table()?.truncated || loading() || (table()?.totalRows ?? 0) > shown().length}><div class="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"><span aria-label="Row count">{loading() ? 'loading rows…' : `${count.format(shown().length)} of ${count.format(table()?.totalRows ?? shown().length)} rows`}</span><Show when={remote() && !loading()}><button type="button" aria-label="Load more rows" onClick={() => readWindow(shown().length, sort(), false)} class="cursor-pointer font-medium underline-offset-2 hover:underline">load more</button></Show></div></Show>
  </div></Show>;
}

export interface QuestionProps { data: unknown; viz?: Record<string, unknown>; title?: string; height?: number | string; id?: string; drawn?: DrawnChart; chart?: () => Promise<IslandChartModule>; refData?: RefDataMap; recipeData?: unknown; inGridItem?: boolean; className?: string; [key: `data-${string}`]: unknown }

const fmt = (v: unknown): string => typeof v === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : String(v ?? '');
/** The `aria-label` Vega gives its container: the spec's description, or vega-parser's default. */
const chartLabel = (envelope: VizEnvelope): string => {
  const spec = (envelope.source as { spec?: unknown }).spec;
  const description = spec && typeof spec === 'object' ? (spec as { description?: unknown }).description : undefined;
  return typeof description === 'string' ? description : 'Vega visualization';
};

/**
 * `<Question>` — today's QuestionAdapter wrapper (`aria-label="Question embed"`, the shared height
 * contract) around today's QuestionEmbed: its placeholders, the KPI tile, the plain table, and the
 * chart. The chart's drawing box is VegaChart's container, and it is the ONLY element carrying the
 * chart slot marker, so the server's drawing lands inside it and the title is in the first paint.
 */
export function Question(props: QuestionProps) {
  const island = useIsland();
  const name = nameOf(props.data);
  const table = () => (name ? island.tableSnapshot(name) : undefined);
  const pending = () => !!name && island.pending(name);
  const kind = () => (props.viz?.kind as string | undefined) ?? 'table';
  const height = () => props.inGridItem ? 'width:100%;height:100%' : `width:100%;height:${questionEmbedHeightPx(props.height, kind() === 'single_value')}px`;
  // A `ref:` recipe reaches the island as the compiler's `recipeData`: the one entry of the ref map it reads.
  const refData = (): RefDataMap | undefined => {
    const recipe = props.viz?.recipe;
    return props.recipeData && typeof recipe === 'string' && recipe.startsWith('ref:') ? { ...props.refData, [recipe.slice(4)]: props.recipeData as RefDataMap[string] } : props.refData;
  };
  const envelope = createMemo(() => { const t = table(); return t ? questionEnvelope(props.viz ?? {}, t.columns, refData()) : null; });
  const state = () => (pending() ? 'pending' : undefined);
  const empty = (message: string) => <div class="flex h-full w-full items-center justify-center p-4 text-sm text-muted-foreground" aria-label="Chart placeholder">{message}</div>;
  const sample = () => <Show when={table()?.truncated}><div aria-label="Sample notice" class="shrink-0 border-t border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">showing the first {new Intl.NumberFormat().format(table()!.rows.length)} of {new Intl.NumberFormat().format(table()!.totalRows ?? table()!.rows.length)} rows</div></Show>;
  const single = () => {
    const t = table()!;
    const cfg = (props.viz?.singleValueConfig ?? {}) as { prefix?: string; suffix?: string; label?: string; format?: string };
    const col = ((props.viz?.yCols as string[] | undefined) ?? [t.columns.find(c => c.type === 'number')?.name ?? t.columns[0]?.name])[0];
    const nums = t.rows.map(r => globalThis.Number(r[col ?? ''])).filter(n => globalThis.Number.isFinite(n));
    const value = nums.length ? nums.reduce((a, b) => a + b, 0) : NaN;
    return { label: cfg.label ?? props.title, text: `${cfg.prefix ?? ''}${!globalThis.Number.isFinite(value) ? '—' : cfg.format ? numberFormatter(cfg.format)(value) : fmt(value)}${cfg.suffix ?? ''}` };
  };
  return <div {...rootProps(props)} aria-label="Question embed" aria-busy={pending() ? 'true' : 'false'} {...attr('class', pending() ? 'mx-busy' : undefined)} {...attr('attr:style', height())}>
    <Switch>
      <Match when={!name}>{empty('data unavailable — bind a declared table with data="$name"')}</Match>
      <Match when={!table() && pending()}><div class="flex h-full w-full flex-col items-center justify-center gap-2.5 p-4" aria-label="Chart placeholder" data-mx-chart-state="pending"><span aria-hidden="true" class={SPINNER} /><span class={LOCKUP_LABEL}>loading data…</span></div></Match>
      <Match when={!table() && island.error(name)}>{error => empty(`query "${name}" failed: ${error()}`)}</Match>
      <Match when={!table()}>{empty(`data unavailable — "$${name}" has no rows yet`)}</Match>
      <Match when={kind() === 'single_value'}>
        <div class="flex h-full w-full flex-col items-start justify-center gap-1 p-4" aria-label="Single value" {...attr('data-mx-chart-state', state())}>
          <Show when={single().label}><div class="text-sm text-muted-foreground">{single().label}</div></Show>
          <div class="text-4xl font-semibold tracking-tight tabular-nums">{single().text}</div>
          {sample()}
        </div>
      </Match>
      <Match when={kind() === 'table'}>
        <div class="flex h-full w-full flex-col" {...attr('data-mx-chart-state', state())}>
          <div class="min-h-0 w-full flex-1 overflow-auto p-2" aria-label="Data table"><table class="w-full text-sm">
            <thead><tr class="border-b border-border text-left text-muted-foreground"><For each={table()!.columns}>{c => <th class="px-2 py-1.5 font-medium">{c.name}</th>}</For></tr></thead>
            <tbody><For each={table()!.rows.slice(0, 200)}>{row => <tr class="border-b border-border/50"><For each={table()!.columns}>{c => <td class={c.type === 'number' ? 'px-2 py-1.5 text-right tabular-nums' : 'px-2 py-1.5'}>{fmt(row[c.name])}</td>}</For></tr>}</For></tbody>
          </table></div>
          {sample()}
        </div>
      </Match>
      <Match when={envelope() && 'error' in envelope()! ? (envelope() as { error: string }).error : null}>{error => empty(error())}</Match>
      <Match when={envelope() as VizEnvelope | null}>{env =>
        <div class="flex h-full w-full flex-col" aria-label="Question embed body" {...attr('data-mx-chart-state', state())}>
          <Show when={props.title}><div class="border-b border-border px-3 py-2 font-mono text-sm font-medium">{props.title}</div></Show>
          <div class="flex min-h-0 flex-1 flex-col"><div class="relative min-h-0 w-full flex-1 overflow-hidden">
            <ChartSlot slot={props[CHART_SLOT_ATTR] as string | undefined} table={name} envelope={env} rows={() => table()?.rows ?? []} drawn={props.drawn} chart={props.chart} />
          </div></div>
          {sample()}
        </div>
      }</Match>
    </Switch>
  </div>;
}

/**
 * VegaChart's container, and the chart slot. The server marks it (`data-mx-chart-slot`, for the
 * assembler only; dropped once mounted) and the assembler puts the snapshot's drawing inside it with
 * `data-mx-chart-state="ready"`. The attributes Vega gives its container are written up front, so a
 * served drawing reads like a drawn chart. The state is never a binding: after the server's
 * `pending`/`ready`, lib/viz/render-readiness owns it, as it does for VegaChart.
 *
 * Drawing: a slot the server did not draw is drawn here at once, as today's reader draws every chart.
 * A served drawing is kept while it is current — the rows it was drawn from are the rows the page was
 * served with, and every later result is checked with `drawingIsCurrent` — and replaced when the
 * rows change or when the reader interacts with it (the lazy Vega chunk). The drawing fills its box
 * from the first paint (`DRAWING_CLASS`; `fitDrawing` for one stored before that).
 */
/** What Vega's initializeAria and cursor handling write on its container (vega-view). */
const VEGA_CONTAINER: Record<string, string> = { role: 'graphics-document', 'aria-roledescription': 'visualization' };
/**
 * A served drawing fills its box from the first paint (charts.server draws it with `DRAWING_CLASS`:
 * out of flow, scaled by its viewBox), so the box has today's size and nothing moves. A drawing
 * stored before that (in the flow, at its nominal height) would hold a smaller box open: it is taken
 * out of the flow here instead, the one layout change such an old drawing still costs.
 */
const FIT = { position: 'absolute', inset: '0px', width: '100%', height: '100%' } as const;
function fitDrawing(el: HTMLElement): void {
  const svg = el.firstElementChild;
  if (!(svg instanceof SVGSVGElement) || DRAWING_CLASS.split(' ').every((c) => svg.classList.contains(c))) return;
  const drawn = globalThis.Number(svg.getAttribute('height'));
  Object.assign(svg.style, FIT);
  const box = el.getBoundingClientRect().height;
  if (box && globalThis.Number.isFinite(drawn) && Math.abs(box - drawn) > 1) return;
  for (const name of Object.keys(FIT)) svg.style.removeProperty(name);
  if (!svg.getAttribute('style')) svg.removeAttribute('style');
}
function ChartSlot(props: { slot?: string; table: string; envelope: () => VizEnvelope; rows: () => Row[]; drawn?: DrawnChart; chart?: () => Promise<IslandChartModule> }) {
  const island = useIsland();
  let el!: HTMLDivElement;
  let controller: IslandChart | undefined;
  let started = false;
  let disposed = false;
  let cancelDraw = () => {};
  let drawing: Promise<DrawnChart | null> = Promise.resolve(null);
  const draw = () => {
    if (started) return;
    started = true;
    const before = el.getAttribute(CHART_STATE_ATTR);
    el.setAttribute(CHART_STATE_ATTR, 'pending');
    cancelDraw = deferEngine(el, () => { void (async () => {
      let module: IslandChartModule;
      try { module = await (props.chart ?? island.loadChart)(); } catch { if (before) el.setAttribute(CHART_STATE_ATTR, before); started = false; return; } // a failed chunk fetch: keep what is shown; the next trigger retries
      if (disposed) return;
      controller = module.mountChart({ element: el, envelope: props.envelope(), rows: props.rows() });
    })(); });
  };
  onMount(() => {
    el.removeAttribute(CHART_SLOT_ATTR);
    if (props.drawn?.svg && !el.firstElementChild) { el.innerHTML = props.drawn.svg; el.setAttribute(CHART_STATE_ATTR, 'ready'); }
    const served = el.getAttribute(CHART_STATE_ATTR) === 'ready' && !!el.firstElementChild;
    if (!served) { void draw(); return; }
    fitDrawing(el);
    const rows = props.rows();
    drawing = props.drawn ? Promise.resolve(props.drawn) : rowsDigest(rows).then(digest => ({ svg: '', table: props.table, rows: digest }), () => null);
  });
  createEffect(on(props.rows, rows => {
    if (controller) { controller.update?.(rows); return; }
    if (started) return;
    void drawing.then(async current => { if (!started && !disposed && !(await drawingIsCurrent(current, rows))) void draw(); });
  }, { defer: true }));
  onCleanup(() => { disposed = true; cancelDraw(); controller?.destroy(); });
  return <div ref={el} {...attr(CHART_SLOT_ATTR, isServer ? props.slot : undefined)} {...{ [CHART_STATE_ATTR]: 'pending' }} aria-label={chartLabel(props.envelope())} class="h-full w-full overflow-hidden [&_.vega-embed]:block [&_svg]:block" {...VEGA_CONTAINER} style="cursor: default;" onPointerEnter={() => void draw()} onClick={() => void draw()} />;
}

/** The embeds, loaded with the data family: their behaviour is a lazy chunk each (./embed). */
export { Iframe, DeckGL } from './embed';
