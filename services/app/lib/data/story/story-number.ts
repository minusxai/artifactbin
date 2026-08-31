/**
 * The `<Number>` inspector's lens (the chart inspector's story-viz.ts, for the
 * inline figure: data="$name", col, agg, prefix, suffix, format — the props
 * InlineNumber renders from). Pure (client + server safe).
 */
import { resolveJsxNodeAtPath, updateJsxElementAtPath, setStaticJsxAttr } from './jsx-edit';
import { parseJsx } from '@/lib/jsx';
import { questionTable } from './story-viz';

/** The aggregations InlineNumber computes; 'first' is its default when the attr is absent. */
export const NUMBER_AGGS = ['first', 'sum', 'avg', 'min', 'max', 'count'] as const;

/** What the Number panel renders from: the `<Number>` at `astPath`, or null if there is none. */
export interface NumberEmbedBinding {
  /** From `data="$name"` — the declared table; null when unbound. */
  table: string | null;
  col: string | null;
  agg: string | null;
  prefix: string | null;
  suffix: string | null;
  format: string | null;
}

export function readNumberEmbed(source: string, astPath: string): NumberEmbedBinding | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const node = resolveJsxNodeAtPath(parsed.nodes, astPath);
  if (!node || node.type !== 'element' || !node.isComponent || node.tag !== 'Number') return null;
  const attr = (name: string) => node.attributes.find((a) => a.name === name)?.value;
  const str = (name: string) => {
    const v = attr(name);
    return v?.static && typeof v.json === 'string' ? v.json : null;
  };
  const data = attr('data');
  return {
    table: data?.static ? questionTable(data.json) : null,
    col: str('col'),
    agg: str('agg'),
    prefix: str('prefix'),
    suffix: str('suffix'),
    format: str('format'),
  };
}

/**
 * A PARTIAL edit: absent fields stay untouched, null removes the attribute, a string sets it.
 * Partial where the chart edit is whole for one reason — a Number's `data` may be inline rows
 * the panel cannot re-emit, so "I did not touch the binding" must be expressible.
 */
export interface NumberEmbedEdit {
  /** A declared table name (`$` added here, like the chart's — a bare name renders nothing); null unbinds. */
  table?: string | null;
  col?: string | null;
  agg?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  format?: string | null;
}

export function updateNumberEmbedInJsx(source: string, astPath: string, edit: NumberEmbedEdit): string {
  // A blank table name is a slip, not an unbind (the unbind is an explicit null) — mirror
  // updateQuestionDataInJsx and refuse the whole edit rather than write a dangling ref.
  if (typeof edit.table === 'string' && !edit.table.trim()) return source;
  return updateJsxElementAtPath(source, astPath, 'Number', (el) => {
    if (edit.table !== undefined) {
      const name = edit.table?.trim();
      setStaticJsxAttr(el, 'data', name ? (name.startsWith('$') ? name : `$${name}`) : undefined);
    }
    for (const name of ['col', 'agg', 'prefix', 'suffix', 'format'] as const) {
      if (edit[name] !== undefined) setStaticJsxAttr(el, name, edit[name] ?? undefined);
    }
  });
}
