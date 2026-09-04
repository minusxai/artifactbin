/** Schema as data → idempotent, additive DDL. Each package declares its own tables with these; utils renders them. */
export interface Column { name: string; type: string; notNull?: boolean; default?: string; retired?: boolean }
export interface Index {
  name: string;
  /**
   * Index columns. A plain name is a column; anything else is emitted VERBATIM
   * as an expression, so `(ancestor_ids[cardinality(ancestor_ids)])` indexes
   * the parent without a stored duplicate of it. Parenthesise it yourself —
   * Postgres requires the parens and the renderer will not guess where.
   */
  columns: string[];
  unique?: boolean;
  where?: string;
  /** Access method (`gin`, `gist`, …). Absent = the engine's default btree. */
  using?: string;
}
export interface Table {
  name: string;
  columns: Column[];
  primaryKey: string[];
  uniques?: string[][];
  indexes?: Index[];
  /**
   * Columns this table once declared and no longer does. Rendered as
   * `ALTER TABLE <t> DROP COLUMN IF EXISTS <c>` — idempotent, so it is safe on
   * every boot, and it is the whole migration for a retired column. Use it
   * only where the data is genuinely dead: a drop cannot be undone by a boot.
   */
  dropped?: string[];
}
