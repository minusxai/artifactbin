/* @jsxImportSource solid-js */
/**
 * The data-bound kit. The island context is the sole source of live tables and values.
 *
 * PARITY: each widget renders the DOM the former reader rendered (the frozen react-oracle recording behind
 * lib/islands/__tests__/kit-parity.ts), compared attribute by attribute. Two consequences shape this file:
 *  - An absent attribute is spread in (`attr()`), never bound to `undefined`: Solid's server
 *    renderer writes `class=""`/`style=""` for an undefined binding, which the former DOM does not have.
 *  - Inline styles are strings in the browser's own serialization (`max-height: 300px;`) wherever
 *    the former React render drew the element in the browser, and in the server's (`width:100%`) where
 *    the former element was the server-rendered adapter wrapper. Those wrapper strings are spread in as
 *    `attr:style` (a raw attribute: hydration leaves it as served), because a `style` binding — and
 *    the JSX `attr:style` form, which the compiler turns back into one — re-sets it through the
 *    CSSOM (`width: 100%;`).
 */
import { createEffect, createMemo, createSignal, type JSX, For, Match, on, onCleanup, onMount, Show, Switch, untrack } from 'solid-js';
import { isServer } from 'solid-js/web';
import type { createDataVirtualizer } from './data-virtualizer';
import { useIsland } from '../context';
import { deferEngine } from '../defer-engine';
import { refName } from '@/lib/dataflow/dataflow';
import type { TableResult, NumberAgg, Row, RefDataMap } from '@/lib/dataflow';
import { aggregateNumber } from '@/lib/dataflow/number-aggregation';
import { numberFormatter } from '@/lib/dataflow/number-format';
import { barFraction, cellTint, formatCell, gridGeometry, parseColumnSpecs, parseSortSpec, parseTableHeight, resolveColumns, sortRows, type SortSpec } from '@/lib/story-ui/data-table';
import { commentMetadata, keyedRowsError } from '@/lib/story-ui/repeat-identity';
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { personFaceBackground, personInitial } from '../person-face';
import type { PersonCard } from '@artifactbin/contracts';
export { Select } from './select';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { IslandChart, IslandChartModule } from '../contract';
import { DRAWING_CLASS, drawingIsCurrent } from '../chart';
import { rowsDigest } from '../digest';
import type { CellScope } from './cells';
import { CHART_SLOT_ATTR, CHART_STATE_ATTR, type DrawnChart } from '@/lib/story-runtime/contract';

const nameOf = (raw: unknown) => refName(raw) ?? '';
/** The authored identity the former adapters put on their outer element: the id and the compiler's `data-*` stamps, never the chart slot marker. */
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
  // The former NumberAdapter: the figure stays while its query re-runs, and the wrapper says so.
  const busy = () => !!nameOf(props.data) && island.pending(nameOf(props.data));
  return <span {...rootProps(props)} data-mx-live="" aria-busy={busy() ? 'true' : 'false'} {...attr('class', busy() ? 'mx-busy-inline' : props.className)}><span aria-label={table() ? 'Live number' : 'Number placeholder'}>{text()}</span></span>;
}

interface ColumnTemplate { col: string; id?: string; path?: string; ids?: string[]; props?: Record<string, unknown>; nodes?: unknown[] }
/** A column's content, compiled: drawn in each row's cell with the row and where the cell sits (interpreter renderCell). */
type CellContent = (row: Row, cell: CellScope) => JSX.Element;
interface DataTableProps { data: unknown; columns?: unknown; sort?: unknown; height?: number | string; sticky?: boolean; className?: string; id?: string; rowKey?: string; inGridItem?: boolean; templates?: ColumnTemplate[]; cells?: (CellContent | undefined)[]; renderCell?: (template: ColumnTemplate, row: Row, index: number) => JSX.Element; resolveSrc?: (url: string) => string | null; [key: `data-${string}`]: unknown }
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
/** A row's React key in the former table: the virtualizer's item key. */
const rowIdentity = (row: Row | undefined, key: string | undefined, index: number): string => {
  const value = key && row ? row[key] : undefined;
  return value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number') ? `index:${index}` : `${typeof value}:${String(value)}`;
};
/** Where the pending lockup spins (QuestionEmbed `waiting`, DataTableAdapter's pending state). */
/** Missing-data UI loads on demand; healthy tables never load its diagnostics. */
function DataPlaceholder(props: { name: string; pending?: boolean; error?: string }) {
  const [view, setView] = createSignal<(input: { name: string; pending?: boolean; error?: string }) => JSX.Element>(() => 'loading data…');
  void import('./data-placeholder').then(module => setView(() => module.default)).catch(() => setView(() => () => 'Data unavailable.'));
  return <>{view()(props)}</>;
}

const SPINNER = 'size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none';
const LOCKUP_LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground';

/**
 * `<DataTable>` — the former DataTableAdapter (its `aria-label="DataTable embed"` wrapper, the
 * placeholder while the table has no result) around the former kit DataTable: a plain table of the
 * first rows as served, then, once mounted with a measured height, the same box as a virtual window.
 */
export function DataTable(props: DataTableProps) {
  const island = useIsland();
  const name = () => nameOf(props.data);
  const table = () => island.table(name());
  const busy = () => !!name() && island.pending(name());
  const wrapper = () => (props.inGridItem ? 'width:100%;height:100%;min-width:0' : 'width:100%;min-width:0');
  return <Show when={!!table()} fallback={
    <div {...rootProps(props)} data-mx-live="" aria-label="DataTable embed" class="flex w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border p-4 text-sm text-muted-foreground" {...attr('attr:style', wrapper())}>
      <DataPlaceholder name={name()} pending={busy()} error={island.error(name())} />
    </div>
  }>
    {/* Cell sessions show saving on an editable table; only a read-only table dims while it refreshes. */}
    <div {...rootProps(props)} data-mx-live="" aria-label="DataTable embed" aria-busy={busy() ? 'true' : 'false'} {...attr('class', busy() && !props.templates?.length ? 'mx-busy' : undefined)} {...attr('attr:style', wrapper())}>
      <DataGrid {...props} table={table} />
    </div>
  </Show>;
}

function DataGrid(props: DataTableProps & { table: () => TableResult | undefined }) {
  const island = useIsland();
  const table = props.table;
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
  // The former adapter hands the kit `templates` (whose props ARE the column spec) or the parsed `columns`.
  const spec = () => props.templates?.length && props.templates.every(t => t.props) ? parseColumnSpecs(props.templates.map(t => t.props)) : parseColumnSpecs(props.columns);
  const resolved = createMemo(() => resolveColumns(spec(), table()?.columns ?? [], shown()));
  const ordered = createMemo(() => remote() ? shown() : sortRows(shown(), sort()));
  const templateOf = (col: string) => props.templates?.find(t => t.col === col);
  // The first template for a column is its content, in the compiler's order.
  const contentOf = (col: string) => { const at = props.templates?.findIndex(t => t.col === col) ?? -1; return at < 0 ? undefined : props.cells?.[at]; };
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
  // In the virtual regime the header row and every body row are the same CSS grid (the former rowGrid).
  const rowGrid = () => ({ display: 'grid', 'grid-template-columns': geometry().template, width: '100%', 'min-width': geometry().minWidth ? `${geometry().minWidth}px` : undefined });
  const [virtualizer, setVirtualizer] = createSignal<ReturnType<typeof createDataVirtualizer> | null>(null);
  let previousRows = ordered().length;
  createEffect(on(() => ordered().length, (count) => {
    if (count < previousRows && scroll) {
      scroll.scrollTop = 0;
      queueMicrotask(() => virtualizer()?.scrollToOffset(0));
    }
    previousRows = count;
  }, { defer: true }));
  const visible = createMemo(() => {
    if (!virtual()) return ordered().slice(0, STATIC_ROWS).map((row, index) => ({ row, index, start: null as number | null }));
    const items = virtualizer()?.getVirtualItems().filter(v => v.index < ordered().length) ?? [];
    if (items.length) return items.map(v => ({ row: ordered()[v.index]!, index: v.index, start: v.start as number | null }));
    // The observer may report its first rect after the switch; keep the window around the offset visible.
    // A filter can shrink a 500-row list to one while the scroll box still holds
    // its old offset. Clamp the fallback window to the new result before layout
    // clamps scrollTop, or the only matching row disappears from the DOM.
    const first = Math.min(Math.max(0, Math.floor((scroll?.scrollTop ?? 0) / ROW_H) - 12), Math.max(0, ordered().length - Math.ceil((scroll?.clientHeight ?? 0) / ROW_H)));
    return Array.from({ length: Math.max(0, Math.min(ordered().length - first, Math.ceil((scroll?.clientHeight ?? 0) / ROW_H) + 24)) }, (_, offset) => ({ row: ordered()[first + offset]!, index: first + offset, start: (first + offset) * ROW_H as number | null }));
  });
  // Rows are keyed by the row object, so the rows served with the page are the rows of the virtual window.
  const placed = createMemo(() => new Map(visible().map(v => [v.row, v])));
  // Reconciliation can keep a row proxy while moving a different key into it. A key change must
  // rebuild the row's comment metadata; same-key content still updates through reactive cell reads.
  const instances = new WeakMap<Row, Map<unknown, { row: Row; key: unknown }>>();
  const rendered = createMemo(() => visible().map(({ row }) => {
    const key = props.rowKey ? row[props.rowKey] : row;
    let keys = instances.get(row);
    if (!keys) { keys = new Map(); instances.set(row, keys); }
    let instance = keys.get(key);
    if (!instance) { instance = { row, key }; keys.set(key, instance); }
    return instance;
  }));
  // The former switch: virtual once mounted with a measured height, whatever the row count; the header
  // widths are read while the served table's auto layout is still on screen.
  onMount(() => {
    if (!scroll?.clientHeight) return;
    setMeasured([...scroll.querySelectorAll('thead th')].map(th => th.getBoundingClientRect().width));
    // Let the compiled page finish hydration before fetching the scrolling engine.
    const timer = setTimeout(() => {
      void import('./data-virtualizer').then(({ createDataVirtualizer }) => {
        if (!scroll.isConnected) return;
        setVirtualizer(createDataVirtualizer({
          scroll: () => scroll,
          count: () => ordered().length,
          key: (index) => rowIdentity(ordered()[index], props.rowKey, index),
          offset: () => scroll.scrollTop,
          rowHeight: ROW_H,
        }));
        setVirtual(true);
      }).catch((error: unknown) => console.error('[islands] table scrolling did not load', error));
    }, 0);
    onCleanup(() => clearTimeout(timer));
  });
  const onScroll = () => { if (!scroll || !remote() || loading()) return; if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - ROW_H * 6 && askedAt !== shown().length) { askedAt = shown().length; readWindow(shown().length, sort(), false); } };
  const cell = (value: unknown, column: ReturnType<typeof resolved>[number], row: Row, index: () => number) => {
    const template = templateOf(column.col);
    const content = contentOf(column.col);
    // The row's position scopes only a row without a stable key: a sort never redraws a cell (or loses its focus).
    if (template && content) return content(row, { owner: owner ?? '', table: String(props['data-mx-ast'] ?? ''), data: name(), key: row[String(props.rowKey)], durable: true, index: untrack(index), column: template.col, ids: template.ids ?? [] });
    if (template?.nodes?.length && props.renderCell) return props.renderCell(template, row, untrack(index));
    if (column.kind === 'image' && typeof value === 'string' && /^https?:\/\//i.test(value)) { const src = props.resolveSrc?.(value); if (src) return <img src={src} alt="" loading="lazy" class="inline-block max-h-8 w-auto align-middle" />; }
    if (column.type === 'user' && typeof value === 'string') return <UserCell id={value} card={island.people()[value]} />;
    if (column.type === 'timestamp' && typeof value === 'string') return <TimestampCell value={value} />;
    return formatCell(value, column);
  };
  const rowMeta = (row: Row, columnKey?: string) => props.rowKey && owner ? commentMetadata(owner, { kind: 'table', rowKey: row[props.rowKey] as string | number, ...(columnKey ? { columnKey } : {}) }) : {};
  const count = new Intl.NumberFormat(undefined);
  const identityError = () => props.rowKey ? keyedRowsError(shown(), props.rowKey) : null;
  return <Show when={!identityError()} fallback={<div role="alert">{identityError()}</div>}><div data-slot="data-table" aria-label="Data grid" class={['flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm', props.className].filter(Boolean).join(' ')}>
    <div ref={scroll} onScroll={onScroll} class="relative min-h-0 w-full flex-1 overflow-auto" style={css({ 'max-height': `${parseTableHeight(props.height)}px` })}>
      <table data-mx-kit-table="" class="w-full border-collapse text-sm" {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}>
        <thead class={`bg-card text-left text-muted-foreground${props.sticky === false ? '' : ' sticky top-0 z-10'}`} {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}><tr class="border-b border-border" {...attr('style', virtual() ? css(rowGrid()) : undefined)}>
          <For each={resolved()}>{column => <th {...attr('id', templateOf(column.col)?.id ?? (typeof templateOf(column.col)?.props?.id === 'string' ? templateOf(column.col)!.props!.id as string : undefined))} {...attr('data-mx-ast', templateOf(column.col)?.path)} scope="col" aria-label={`Sort by ${column.title}`} aria-sort={sort()?.col === column.col ? sort()?.dir === 'asc' ? 'ascending' : 'descending' : 'none'} {...attr('title', column.type === 'string' && !(table()?.columns ?? []).some(k => k.name === column.col) ? `"${column.col}" is not a column of this table` : undefined)} onClick={() => cycle(column.col)} class="min-w-0 cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-bold" style={css({ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined })}>{column.title}<Show when={sort()?.col === column.col}><span aria-hidden="true" class="ml-1 opacity-70">{sort()?.dir === 'asc' ? '▲' : '▼'}</span></Show></th>}</For>
        </tr></thead>
        <tbody {...attr('style', virtual() ? css({ display: 'block', height: `${virtualizer()?.getTotalSize() ?? ordered().length * ROW_H}px`, position: 'relative' }) : undefined)}><Show when={ordered().length} fallback={<tr {...attr('style', virtual() ? css({ display: 'block' }) : undefined)}><td colSpan={Math.max(1, resolved().length)} class="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>}>
          <For each={rendered()}>{instance => {
            const row = instance.row;
            const at = () => placed().get(row);
            const index = () => at()?.index ?? 0;
            let el!: HTMLTableRowElement;
            createEffect(() => { if (virtual() && at()) virtualizer()?.measureElement(el); });
            return <tr ref={el} {...rowMeta(row)} data-index={index()} class="border-b border-border/50 transition-colors hover:bg-muted/30" {...attr('style', at()?.start == null ? undefined : css({ ...rowGrid(), position: 'absolute', top: '0px', left: '0px', transform: `translateY(${at()!.start}px)` }))}><For each={resolved()}>{column => { const value = () => row[column.col]; const bar = () => barFraction(value(), column); const tint = () => cellTint(value(), column); return <td {...rowMeta(row, column.col)} class={`relative min-w-0 overflow-hidden whitespace-nowrap px-3 py-1.5 align-middle${column.type === 'number' ? ' tabular-nums' : ''}`} style={css({ 'text-align': column.align, width: column.width ? `${column.width}px` : undefined, background: tint() ?? undefined })}><Show when={bar() !== null}><span data-bar="" aria-hidden="true" class="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-25" style={css({ width: `${Math.round((bar() ?? 0) * 100)}%`, background: typeof column.bar === 'object' && column.bar.color ? column.bar.color : 'var(--chart-1)' })} /></Show><span class="relative block min-w-0 max-w-full truncate">{cell(value(), column, row, index)}</span></td>; }}</For></tr>;
          }}</For>
        </Show></tbody>
      </table>
    </div>
    <Show when={table()?.truncated || loading() || (table()?.totalRows ?? 0) > shown().length}><div class="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"><span aria-label="Row count">{loading() ? 'loading rows…' : `${count.format(shown().length)} of ${count.format(table()?.totalRows ?? shown().length)} rows`}</span><Show when={remote() && !loading()}><button type="button" aria-label="Load more rows" onClick={() => readWindow(shown().length, sort(), false)} class="cursor-pointer font-medium underline-offset-2 hover:underline">load more</button></Show></div></Show>
  </div></Show>;
}

interface QuestionProps { data: unknown; viz?: Record<string, unknown>; title?: string; height?: number | string; id?: string; drawn?: DrawnChart; chart?: () => Promise<IslandChartModule>; refData?: RefDataMap; recipeData?: unknown; inGridItem?: boolean; className?: string; [key: `data-${string}`]: unknown }

const fmt = (v: unknown): string => typeof v === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : String(v ?? '');
/** The `aria-label` Vega gives its container: the spec's description, or vega-parser's default. */
const chartLabel = (envelope: VizEnvelope): string => {
  const spec = (envelope.source as { spec?: unknown }).spec;
  const description = spec && typeof spec === 'object' ? (spec as { description?: unknown }).description : undefined;
  return typeof description === 'string' ? description : 'Vega visualization';
};

/**
 * `<Question>` — the former QuestionAdapter wrapper (`aria-label="Question embed"`, the shared height
 * contract) around the former QuestionEmbed: its placeholders, the KPI tile, the plain table, and the
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
  const empty = (message: JSX.Element) => <div class="flex h-full w-full items-center justify-center p-4 text-sm text-muted-foreground" aria-label="Chart placeholder">{message}</div>;
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
      <Match when={!table() && island.error(name)}>{error => empty(<DataPlaceholder name={name} error={error()} />)}</Match>
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
 * Drawing: a slot the server did not draw is drawn here at once, as the former reader draws every chart.
 * A served drawing is kept while it is current — the rows it was drawn from are the rows the page was
 * served with, and every later result is checked with `drawingIsCurrent` — and replaced when the
 * reader readiness and visibility, when rows change, or on early input (the lazy Vega chunk). The drawing fills its box
 * from the first paint (`DRAWING_CLASS`; `fitDrawing` for one stored before that).
 */
/** What Vega's initializeAria and cursor handling write on its container (vega-view). */
const VEGA_CONTAINER: Record<string, string> = { role: 'graphics-document', 'aria-roledescription': 'visualization' };
/**
 * A served drawing fills its box from the first paint (charts.server draws it with `DRAWING_CLASS`:
 * out of flow, scaled by its viewBox), so the box has the former size and nothing moves. A drawing
 * stored before that (in the flow, at its nominal height) would hold a smaller box open: it is taken
 * out of the flow here instead, the one layout change such an old drawing still costs.
 */
function ChartSlot(props: { slot?: string; table: string; envelope: () => VizEnvelope; rows: () => Row[]; drawn?: DrawnChart; chart?: () => Promise<IslandChartModule> }) {
  const island = useIsland();
  let el!: HTMLDivElement;
  let controller: IslandChart | undefined;
  let started = false;
  let disposed = false;
  const [showLoading, setShowLoading] = createSignal(false);
  let indicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let readiness: MutationObserver | undefined;
  const stopLoading = () => {
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = undefined;
    if (el) el.setAttribute('aria-busy', 'false');
    setShowLoading(false);
  };
  let cancelDraw = () => {};
  let drawing: Promise<DrawnChart | null> = Promise.resolve(null);
  const draw = () => {
    if (started) return;
    started = true;
    const before = el.getAttribute(CHART_STATE_ATTR);
    el.setAttribute('aria-busy', 'true');
    indicatorTimer = setTimeout(() => setShowLoading(true), 150);
    el.setAttribute(CHART_STATE_ATTR, 'pending');
    cancelDraw = deferEngine(el, () => { void (async () => {
      let module: IslandChartModule;
      try { module = await (props.chart ?? island.loadChart)(); } catch { if (before) el.setAttribute(CHART_STATE_ATTR, before); started = false; stopLoading(); return; } // a failed chunk fetch: keep what is shown; the next trigger retries
      if (disposed) return;
      controller = module.mountChart({ element: el, envelope: props.envelope(), rows: props.rows() });
    })(); });
  };
  onMount(() => {
    readiness = new MutationObserver(() => { if (el.getAttribute(CHART_STATE_ATTR) === 'ready') stopLoading(); });
    readiness.observe(el, { attributes: true, attributeFilter: [CHART_STATE_ATTR] });
    el.removeAttribute(CHART_SLOT_ATTR);
    if (props.drawn?.svg && !el.firstElementChild) { el.innerHTML = props.drawn.svg; el.setAttribute(CHART_STATE_ATTR, 'ready'); }
    const served = el.getAttribute(CHART_STATE_ATTR) === 'ready' && !!el.firstElementChild;
    if (!served) { void draw(); return; }
    // Legacy-only compatibility stays behind a lazy browser boundary; current snapshots already fit.
    const svg = el.firstElementChild;
    if (svg instanceof SVGSVGElement && !DRAWING_CLASS.split(' ').every(c => svg.classList.contains(c))) {
      void import('./fit-drawing').then(module => { if (!disposed) module.fitDrawing(el); }).catch(() => { /* Preserve the visible snapshot if compatibility cannot load. */ });
    }
    const rows = props.rows();
    drawing = props.drawn ? Promise.resolve(props.drawn) : rowsDigest(rows).then(digest => ({ svg: '', table: props.table, rows: digest }), () => null);
    // Schedule the large controller only after reader readiness and visibility; the SVG stays in place.
    void draw();
  });
  createEffect(on(props.rows, rows => {
    if (controller) { controller.update?.(rows); return; }
    if (started) return;
    void drawing.then(async current => { if (!started && !disposed && !(await drawingIsCurrent(current, rows))) void draw(); });
  }, { defer: true }));
  onCleanup(() => { disposed = true; cancelDraw(); readiness?.disconnect(); stopLoading(); controller?.destroy(); });
  return <>
    <div ref={el} {...attr(CHART_SLOT_ATTR, isServer ? props.slot : undefined)} {...{ [CHART_STATE_ATTR]: 'pending' }} aria-label={chartLabel(props.envelope())} class="h-full w-full overflow-hidden [&_.vega-embed]:block [&_svg]:block" {...VEGA_CONTAINER} style="cursor: default;" onPointerEnter={() => void draw()} onClick={() => void draw()} />
    <Show when={showLoading()}><span role="status" aria-label="Chart loading; interactions available when ready" class="pointer-events-none absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background/85 text-muted-foreground shadow-sm"><span aria-hidden="true" class="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" /></span></Show>
  </>;
}
