'use client';

/**
 * THE QUERY BEHIND THE DATA — what the chart and number inspectors show under
 * their table picker when the bound table is a `<Query>`: its SQL, read-only,
 * and a way into the notebook rail where SQL is edited (and where the notebook
 * can also say what else the query powers). A table `<Value>` has no query,
 * so the block renders nothing.
 */
import type { TableChoice } from '@/lib/story/table-catalog';

export interface BoundQueryProps {
  /** The table the embed is bound to, as the catalog lists it — null when unbound or undeclared. */
  table: TableChoice | null;
  /** Open the named query in the notebook (InPlaceEditor). Absent where there is no rail: SQL only, no opener. */
  onOpenQuery?: (name: string) => void;
}

export default function BoundQuery({ table, onOpenQuery }: BoundQueryProps) {
  if (table?.kind !== 'query' || table.sql === undefined) return null;
  return (
    <div className="flex flex-col gap-1" aria-label="Bound query">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-faint">query</span>
        {onOpenQuery && (
          <button
            type="button"
            aria-label={`Open $${table.name} in queries`}
            onClick={() => onOpenQuery(table.name)}
            className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
          >
            edit in queries
          </button>
        )}
      </div>
      <pre
        aria-label="Bound query SQL"
        className="max-h-40 overflow-auto whitespace-pre rounded-[4px] border border-edge bg-raised p-2 font-mono text-[11px] leading-[1.5] text-fg"
      >
        {table.sql}
      </pre>
    </div>
  );
}
