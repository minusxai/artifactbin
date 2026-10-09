/* @jsxImportSource solid-js */
/**
 * The query behind the data: what the chart and
 * number inspectors show under their table picker when the bound table is a `<Query>`. A table
 * `<Value>` has no query, so this renders nothing.
 */
import { Show, type JSX } from 'solid-js';
import type { TableChoice } from '@/lib/document/table-catalog';

interface BoundQueryProps {
  /** The table the embed is bound to, as the catalog lists it — null when unbound or undeclared. */
  table: TableChoice | null;
  /** Open the named query in the notebook. Absent where there is no rail: SQL only, no opener. */
  onOpenQuery?: (name: string) => void;
}

export default function BoundQuery(props: BoundQueryProps): JSX.Element {
  return (
    <Show when={props.table?.kind === 'query' && props.table.sql !== undefined ? props.table : null}>
      {(table) => (
        <div class="flex flex-col gap-1" aria-label="Bound query">
          <div class="flex items-baseline justify-between">
            <span class="font-mono text-[11px] text-faint">query</span>
            <Show when={props.onOpenQuery}>
              {(onOpenQuery) => (
                <button
                  type="button"
                  aria-label={`Open $${table().name} in queries`}
                  onClick={() => onOpenQuery()(table().name)}
                  class="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
                >
                  edit in queries
                </button>
              )}
            </Show>
          </div>
          <pre aria-label="Bound query SQL" class="max-h-40 overflow-auto whitespace-pre rounded-[4px] border border-edge bg-raised p-2 font-mono text-[11px] leading-[1.5] text-fg">
            {table().sql}
          </pre>
        </div>
      )}
    </Show>
  );
}
