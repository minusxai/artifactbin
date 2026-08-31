/**
 * Write-back for a `<Question>`'s DATA BINDING and VISUALISATION.
 *
 * Editing a chart in the WYSIWYG editor is not a new kind of edit — it is a
 * prop edit on a component, which `updateJsxElementAtPath` + `setStaticJsxAttr`
 * already do for `<GridItem>` coordinates and `<Number>` queries. The only
 * thing new here is that `viz` holds an OBJECT (`viz={{"kind":"vega-lite",…}}`)
 * rather than a string or number, which `setStaticJsxAttr` accepts because it
 * takes a JsonValue.
 *
 * Everything goes through the same staleness guard as every other write-back: a
 * path that no longer resolves, or resolves to something that is not a
 * `<Question>`, leaves the source untouched. A stale path arriving from a
 * remounted canvas must never corrupt a story body.
 */
import type { JsonValue } from '@/lib/jsx/types';
import { refName } from '@/lib/story/dataflow';
import { parseJsx } from '@/lib/jsx';
import { resolveJsxNodeAtPath, setStaticJsxAttr, updateJsxElementAtPath } from './jsx-edit';

/** A vega-lite envelope as stored in the `viz` prop. */
export interface VizEnvelopeValue {
  kind: string;
  [key: string]: JsonValue | undefined;
}

/**
 * Replace the visualisation envelope on the `<Question>` at `astPath`.
 *
 * Passing `undefined` REMOVES the prop, which is meaningful rather than a
 * no-op: a `<Question>` with no `viz` renders the themed table, so "show this
 * as a table" and "clear the chart" are the same edit.
 */
export function updateQuestionVizInJsx(
  source: string,
  astPath: string,
  viz: VizEnvelopeValue | undefined,
): string {
  return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
    setStaticJsxAttr(el, 'viz', viz as JsonValue | undefined);
  });
}

/**
 * Point the `<Question>` at `astPath` to a different declared table (a
 * <Query> or table <Value> name — lib/story/dataflow.ts).
 *
 * The `$` is added here rather than expected from the caller: a bare name in
 * `data` resolves to nothing and renders an empty chart, and that is exactly
 * the mistake this editor exists to make impossible.
 *
 * `null` UNBINDS (removes the prop); an empty/whitespace string is a slip and
 * is ignored. The distinction matters: the picker offers "no table", and
 * collapsing the two left the stale binding in the document while the UI
 * showed the Question as unbound.
 */
export function updateQuestionDataInJsx(source: string, astPath: string, table: string | null): string {
  if (table === null) {
    return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
      setStaticJsxAttr(el, 'data', undefined);
    });
  }
  const name = table.trim();
  if (!name) return source;
  const ref = name.startsWith('$') ? name : `$${name}`;
  return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
    setStaticJsxAttr(el, 'data', ref);
  });
}

/**
 * The whole chart edit, as the editor makes it: binding and visualisation move
 * together.
 *
 * The panel always knows both — it renders from both — so emitting them
 * separately would only create a window in which the document holds a chart
 * over the wrong dataset. One call, one intent.
 */
export function updateQuestionChartInJsx(
  source: string,
  astPath: string,
  next: { viz: VizEnvelopeValue | undefined; table: string | null },
): string {
  return updateQuestionVizInJsx(updateQuestionDataInJsx(source, astPath, next.table), astPath, next.viz);
}

/**
 * Rename the `<Question>` at `astPath` — the title prop is the header strip.
 *
 * `null` or a whitespace-only string REMOVES the prop: a Question with no title
 * renders no strip, and an empty strip would read as a rendering bug rather
 * than a choice.
 */
export function updateQuestionTitleInJsx(source: string, astPath: string, title: string | null): string {
  const trimmed = title?.trim() ?? '';
  return updateJsxElementAtPath(source, astPath, 'Question', (el) => {
    setStaticJsxAttr(el, 'title', trimmed ? title! : undefined);
  });
}

/**
 * Stands in for a `viz` prop the editor cannot read — `viz={buildSpec(x)}`, an
 * expression rather than a literal. It deliberately fails `isEditableVizProp`,
 * so the panel says "hand-written, edit it in code mode" instead of quietly
 * replacing someone's expression with a frozen literal.
 */
export const DYNAMIC_VIZ = { kind: 'dynamic' } as const;

/** What the chart panel renders from: the `<Question>` at `astPath`, or null if there is none. */
export interface QuestionChart {
  viz: unknown;
  /** The declared table it is bound to (`data="$name"` → "name"), or null. */
  table: string | null;
  /** The header strip. A dynamic `title={expr}` reads as null — nothing to show, nothing to clobber. */
  title: string | null;
}

export function readQuestionChart(source: string, astPath: string): QuestionChart | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const node = resolveJsxNodeAtPath(parsed.nodes, astPath);
  if (!node || node.type !== 'element' || !node.isComponent || node.tag !== 'Question') return null;
  const attr = (name: string) => node.attributes.find((a) => a.name === name)?.value;
  const viz = attr('viz');
  const data = attr('data');
  const title = attr('title');
  return {
    viz: viz === undefined ? undefined : viz.static ? viz.json : DYNAMIC_VIZ,
    table: data?.static ? questionTable(data.json) : null,
    title: title?.static && typeof title.json === 'string' ? title.json : null,
  };
}

/** The declared table a `<Question>`'s `data` prop points at (`"$sales"` → `"sales"`), or null. */
export function questionTable(data: unknown): string | null {
  return typeof data === 'string' ? refName(data.trim()) : null;
}
