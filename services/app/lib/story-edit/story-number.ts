/**
 * The `<Cell>` inspector's shapes (the inline figure: data="$name", col, agg, prefix, suffix, format — the props
 * InlineNumber renders from). Pure (client + server safe).
 */

/** The aggregations InlineNumber computes; 'first' is its default when the attr is absent. */
export { NUMBER_AGGS } from '@/lib/dataflow/number-aggregation';

/** What the Number panel renders from: the `<Cell>`'s binding. */
export interface NumberEmbedBinding {
  /** From `data="$name"` — the declared table; null when unbound. */
  table: string | null;
  col: string | null;
  agg: string | null;
  prefix: string | null;
  suffix: string | null;
  format: string | null;
}

/**
 * A PARTIAL edit: absent fields stay untouched, null removes the attribute, a string sets it.
 * Partial because a Number's `data` may be inline rows the panel cannot re-emit, so "I did not touch the binding"
 * must be expressible.
 */
export interface NumberEmbedEdit {
  /** A declared table name (a bare name renders nothing, so writers add the `$`); null unbinds. */
  table?: string | null;
  col?: string | null;
  agg?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  format?: string | null;
}
