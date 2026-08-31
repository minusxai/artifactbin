'use client';

/**
 * The data-backed chart embed — the adaptation of minusx's SQL-era Question
 * containers, and SQL-era again: `data="$name"` names a `<Query>` (or a
 * table `<Value>`) declared in the Helmet of the document, and the rows come from
 * the runtime store (lib/story-runtime/store.ts). Rendering contract unchanged:
 * rows are injected as the named Vega dataset "main" (via the ported
 * VegaChart), envelope kinds vega-lite | vega | recipe | table | single_value.
 *
 * Chrome here is token classes only (this file is in EXTRA_CLASS_SOURCES): the
 * story iframe's sole stylesheet is the compiled story CSS.
 */
import dynamic from '@/lib/dynamic';
import { format as d3format } from 'd3-format';
import { materializeFileRecipe } from '@/lib/viz/recipe-file';
import type { VizResultColumn } from '@/lib/viz/types';
import { columnVizKind, type DatasetColumn } from '@/lib/story/dataset-shape';
import { refName, type TableResult } from '@/lib/story/dataflow';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

/**
 * The vega stack behind VegaChart (vega + vega-lite + vega-interpreter +
 * vega-tooltip) is ~500 KB gzipped — two thirds of the JS on the reader route —
 * so it loads through the same dynamic boundary that keeps Monaco away from
 * readers (guarded by lib/__tests__/reader-bundle-hygiene.test.ts). Table and
 * single_value embeds never trigger the fetch; a chart shows its placeholder
 * chrome for the beat the chunk is in flight. (No apostrophes in comments
 * here: the recipe-class extractor tokenizes this file — see
 * scripts/generate-story-ui-classes.ts.)
 */
/**
 * The ONE loading lockup every embed state speaks: a spinning ring over a mono
 * uppercase label, centered — the same visual language as the .mx-busy
 * updating overlay (lib/story-runtime/chrome-css.ts), composed from utilities
 * so it also works on the canvas, which carries no embed CSS.
 */
const waiting = (label: string) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-4" aria-label="Chart placeholder">
    <span aria-hidden="true" className="size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
  </div>
);

const VegaChart = dynamic(() => import('@/components/viz/VegaChart').then((m) => m.VegaChart), {
  ssr: false,
  loading: () => waiting('loading chart…'),
});

export interface QuestionEmbedProps {
  /** `"$name"` — a table declared in the document (a <Query> or a table <Value>). */
  data: unknown;
  viz: Record<string, unknown> | undefined;
  title?: string;
  colorMode: 'light' | 'dark';
  /** The document's tables by declared name (the store snapshot). */
  tables?: Record<string, TableResult>;
  /** Queries that failed, by name → the engine's message. */
  tableErrors?: Record<string, string>;
  /**
   * The table names a re-run has in flight. Names, not a flag: "loading" is a
   * claim about THIS embed's table, and a document-wide boolean made one
   * chart's in-flight rebind speak for every other chart on the page.
   */
  pendingTables?: ReadonlySet<string> | readonly string[];
  /** Resolved `ref:` data — recipes only reach the embed this way. */
  refData?: RefDataMap;
}

const fmt = (v: unknown): string =>
  typeof v === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : String(v ?? '');
/** d3-format, falling back to the default for a spec d3 rejects (an author typo must not blank a tile). */
const safeFormat = (spec: string, v: number): string => { try { return d3format(spec)(v); } catch { return fmt(v); } };

const isPending = (pending: QuestionEmbedProps['pendingTables'], name: string): boolean =>
  pending instanceof Set ? pending.has(name) : Array.isArray(pending) ? pending.includes(name) : false;

export default function QuestionEmbed({ data, viz, title, colorMode, tables, tableErrors, pendingTables, refData }: QuestionEmbedProps) {
  const name = refName(data);
  const resolved: { rows: Array<Record<string, unknown>>; columns: DatasetColumn[] } | null =
    name && tables?.[name] ? { rows: tables[name].rows, columns: tables[name].columns } : null;

  const empty = (msg: string) => (
    <div className="flex h-full w-full items-center justify-center p-4 text-sm text-muted-foreground" aria-label="Chart placeholder">
      {msg}
    </div>
  );
  // "did not resolve" is a VERDICT, and it is wrong while the query is still
  // running: unresolved-and-pending is loading; a query that failed says why
  // (the engine message is the route to a fix for the author); unresolved-and-
  // settled is the real fallback.
  if (!resolved) {
    if (!name) return empty('data unavailable — bind a declared table with data="$name"');
    if (isPending(pendingTables, name)) return waiting('loading data…');
    const error = tableErrors?.[name];
    if (error) return empty(`query "${name}" failed: ${error}`);
    return empty(`data unavailable — "$${name}" has no rows yet`);
  }
  const rows = resolved.rows;
  const kind = (viz?.kind as string | undefined) ?? 'table';
  // A result cut at the row cap is a SAMPLE, and a chart cannot show that on
  // its own — say it, in the embed, every time (the DataTable footer does).
  const cut = name && tables?.[name]?.truncated ? tables[name] : null;
  const sample = cut ? (
    <div aria-label="Sample notice" className="shrink-0 border-t border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
      showing the first {new Intl.NumberFormat().format(rows.length)} of {new Intl.NumberFormat().format(cut.totalRows ?? rows.length)} rows
    </div>
  ) : null;

  if (kind === 'single_value') {
    const yCols = (viz?.yCols as string[] | undefined) ?? [resolved.columns.find((c) => c.type === 'number')?.name ?? resolved.columns[0]?.name];
    const cfg = (viz?.singleValueConfig ?? {}) as { prefix?: string; suffix?: string; label?: string; format?: string };
    const col = yCols[0];
    const nums = rows.map((r) => Number(r[col])).filter((n) => Number.isFinite(n));
    const value = nums.length ? nums.reduce((a, b) => a + b, 0) : NaN;
    // A KPI tile takes the same d3-format spec <Number> does; the Intl default otherwise.
    const shown = !Number.isFinite(value) ? '—' : cfg.format ? safeFormat(cfg.format, value) : fmt(value);
    return (
      <div className="flex h-full w-full flex-col items-start justify-center gap-1 p-4" aria-label="Single value">
        {(cfg.label ?? title) && <div className="text-sm text-muted-foreground">{cfg.label ?? title}</div>}
        <div className="text-4xl font-semibold tracking-tight tabular-nums">
          {cfg.prefix ?? ''}{shown}{cfg.suffix ?? ''}
        </div>
        {sample}
      </div>
    );
  }

  if (kind === 'table') {
    return (
      <div className="flex h-full w-full flex-col">
      <div className="min-h-0 w-full flex-1 overflow-auto p-2" aria-label="Data table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {resolved.columns.map((c) => <th key={c.name} className="px-2 py-1.5 font-medium">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                {resolved.columns.map((c) => (
                  <td key={c.name} className={c.type === 'number' ? 'px-2 py-1.5 text-right tabular-nums' : 'px-2 py-1.5'}>{fmt(row[c.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sample}
      </div>
    );
  }

  // The minusx envelope is VERSIONED: { version: 2, source: {kind, grammar, spec} }
  // (resolveEnvelopeSpec reads envelope.source) — the markup's viz attr is the
  // SOURCE shorthand; wrap it here.
  let envelope: VizEnvelope | null = null;
  if (kind === 'vega-lite' || kind === 'vega') {
    const grammar = kind === 'vega-lite' ? 'vega-lite@6' : 'vega@6';
    envelope = { version: 2, source: { kind, grammar, spec: viz?.spec ?? {} } } as unknown as VizEnvelope;
  } else if (kind === 'recipe' && typeof viz?.recipe === 'string' && !viz.recipe.startsWith('ref:')) {
    // A SHIPPED registry recipe (minusx/trend@1, …): the envelope carries the
    // reference and resolveEnvelopeSpec materializes it inside VegaChart —
    // deliberately NOT resolved here, which would drag the template registry
    // into the entry every reader downloads (it lives in the chart chunk).
    envelope = {
      version: 2,
      source: {
        kind: 'recipe',
        recipe: viz.recipe,
        bindings: viz?.bindings ?? {},
        params: (viz?.params ?? null) as Record<string, unknown> | null,
        columnFormats: (viz?.columnFormats ?? null) as Record<string, unknown> | null,
      },
    } as unknown as VizEnvelope;
  } else if (kind === 'recipe') {
    const recipeRef = viz?.recipe;
    let recipe = null;
    if (typeof recipeRef === 'string' && recipeRef.startsWith('ref:')) {
      const r = refData?.[recipeRef.slice(4)];
      if (r?.kind === 'viz') recipe = r.recipe;
    }
    if (!recipe) return empty('recipe unavailable — falling back');
    const cols: VizResultColumn[] = resolved.columns.map((c) => ({ name: c.name, kind: columnVizKind(c.type) }));
    const m = materializeFileRecipe(recipe, (viz?.bindings ?? {}) as Record<string, string | string[]>, (viz?.params ?? null) as Record<string, unknown> | null, cols);
    if (!m.ok) return empty(`recipe error: ${m.error}`);
    envelope = {
      version: 2,
      source: {
        kind: m.engine,
        grammar: m.engine === 'vega-lite' ? 'vega-lite@6' : 'vega@6',
        spec: m.spec,
      },
    } as unknown as VizEnvelope;
  }
  if (!envelope) return empty(`unknown viz kind "${kind}"`);

  return (
    <div className="flex h-full w-full flex-col" aria-label="Question embed body">
      {/* Mono like the chart below it — the title is chart chrome, not body prose,
          and the axes/labels already speak JetBrains Mono. */}
      {title && <div className="border-b border-border px-3 py-2 font-mono text-sm font-medium">{title}</div>}
      {/* flex chain all the way down: VegaChart's flex-1 root needs a flex parent
          with a resolved height, or its measure reads 0 and Vega renders empty. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <VegaChart envelope={envelope} rows={rows} colorMode={colorMode} />
      </div>
      {sample}
    </div>
  );
}
