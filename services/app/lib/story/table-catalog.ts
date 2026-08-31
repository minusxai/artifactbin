/**
 * The tables a document DECLARES, as the editor's binding pickers list them
 * (VizEditorPanel / NumberEditorPanel): every <Query> and table <Value> in
 * the Helmet, with the columns the current dataflow state knows for it — a
 * query's result columns once it has run, a table Value's own. Pure: derived
 * from source (+ state), never fetched — the shelf is the document itself.
 */
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from './helmet';
import type { DatasetColumn } from './dataset-shape';
import type { DataflowState } from './dataflow';

export interface TableChoice {
  /** The declared name (`data="$name"` binds it). */
  name: string;
  kind: 'query' | 'value';
  columns: DatasetColumn[];
}

export function tableChoices(source: string, state?: DataflowState | null): TableChoice[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [];
  const { content } = splitHelmet(parsed.nodes);
  const out: TableChoice[] = [];
  for (const v of content.values) {
    if (v.kind === 'table') out.push({ name: v.name, kind: 'value', columns: state?.tables[v.name]?.columns ?? v.columns });
  }
  for (const q of content.queries) {
    out.push({ name: q.name, kind: 'query', columns: state?.tables[q.name]?.columns ?? [] });
  }
  return out;
}
