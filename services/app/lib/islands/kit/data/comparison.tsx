/* @jsxImportSource solid-js */
/**
 * `<DataTable transpose>` — a comparison, drawn by kit/data `DataTable` in place of its sortable grid. Under kit/data/
 * so the recipe-class reach counts its classes as the data family's.
 */
import { createMemo, For, Show } from 'solid-js';
import type { TableResult } from '@/lib/dataflow';
import { compareTable, MAX_COMPARE_ITEMS, parseMetricSpecs } from '@/lib/story-ui/compare';
import { TABLE_CLASSES } from './table-classes';

interface ComparisonProps { table: () => TableResult | undefined; header?: string; metrics?: unknown; edge?: boolean; className?: string }

/** The measure column stays in view while the items scroll sideways; it paints the card under itself. */
const PINNED = 'sticky left-0 z-[1] bg-card';
/**
 * `<DataTable transpose>` — a comparison: each row of the table becomes a column headed by its `header`
 * cell, each metric a row (lib/story-ui/compare computes it). A static table drawn as served, with
 * DataTable's own classes element by element (TABLE_CLASSES): no virtual window, no sorting, no remote
 * paging, its own sideways scroll box with the measure column pinned. At most MAX_COMPARE_ITEMS items;
 * the footer says what was left out.
 */
export default function ComparisonGrid(props: ComparisonProps) {
  const model = createMemo(() => compareTable({
    rows: props.table()?.rows ?? [], columns: props.table()?.columns ?? [], edge: props.edge === true,
    header: typeof props.header === 'string' ? props.header : undefined,
    metrics: props.metrics === undefined ? null : parseMetricSpecs(props.metrics),
  }));
  const total = () => Math.max(model().total, props.table()?.totalRows ?? 0);
  const right = 'text-align: right;';
  const left = 'text-align: left;';
  return <div data-slot="data-table" aria-label="Comparison table" class={[TABLE_CLASSES.box, props.className].filter(Boolean).join(' ')}>
    <div class={TABLE_CLASSES.scroll}>
      <table data-mx-kit-table="" data-mx-compare="" class={TABLE_CLASSES.table}>
        <thead class={TABLE_CLASSES.head}><tr class={TABLE_CLASSES.headRow}>
          <th scope="col" class={`${TABLE_CLASSES.headCell} ${PINNED}`} style={left}><span class="sr-only">Measure</span></th>
          <For each={model().items}>{item => <th scope="col" class={TABLE_CLASSES.headCell} style={right}>{item}</th>}</For>
          <Show when={props.edge === true}><th scope="col" class={TABLE_CLASSES.headCell} style={right}>Edge</th></Show>
        </tr></thead>
        <tbody><Show when={model().items.length} fallback={<tr><td colSpan={2} class="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>}>
          <For each={model().rows}>{row => <tr class={TABLE_CLASSES.row}>
            <th scope="row" class={`${TABLE_CLASSES.cell} ${PINNED} font-normal`} style={left}>{row.title}</th>
            <For each={row.cells}>{cell => <td class={`${TABLE_CLASSES.cell} tabular-nums`} style={right}>
              <span class="block"><span {...(cell.best ? { class: 'font-bold text-foreground' } : {})}>{cell.text}</span><Show when={cell.rank}>{rank => <span class="ml-1.5 text-xs text-muted-foreground">{rank()}</span>}</Show></span>
              <Show when={cell.sub}>{sub => <span class="block text-xs text-muted-foreground">{sub()}</span>}</Show>
            </td>}</For>
            <Show when={props.edge === true}><td class={`${TABLE_CLASSES.cell} text-xs text-muted-foreground`} style={right}><Show when={row.edge}>{edge => <><strong class="font-bold text-foreground">{edge().lead}</strong>{edge().rest}</>}</Show></td></Show>
          </tr>}</For>
        </Show></tbody>
      </table>
    </div>
    <Show when={total() > model().items.length}><div class={TABLE_CLASSES.footer}><span aria-label="Item count">{`showing ${model().items.length} of ${total()} items — a comparison holds ${MAX_COMPARE_ITEMS}; filter the query to choose which`}</span></div></Show>
  </div>;
}

