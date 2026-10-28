/**
 * The tables a document DECLARES, as the editor's binding pickers list them
 * (VizEditorPanel / NumberEditorPanel): every <Query> and table <Value> in
 * the Helmet, with the columns the current dataflow state knows for it — a
 * query's result columns once it has run, a table Value's own. Pure: derived
 * from source (+ state), never fetched — the shelf is the document itself.
 */
import type { DatasetColumn } from '@/lib/dataflow';

export interface TableChoice {
  /** The declared name (`data="$name"` binds it). */
  name: string;
  kind: 'query' | 'value';
  columns: DatasetColumn[];
  /** The SQL behind a query table — what the inspector shows under the picker. Absent for a table Value. */
  sql?: string;
}
