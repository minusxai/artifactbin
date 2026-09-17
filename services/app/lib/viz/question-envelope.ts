/**
 * The adapter between what a `<Question>` STORES and what the encoding helpers
 * EDIT.
 *
 *   stored prop   {kind: 'vega-lite', spec: {...}}
 *   envelope      {version: 2, source: {kind: 'vega-lite', spec: {...}}, ...}
 *
 * `lib/viz/encoding-edit` operates on the envelope (it was written for a world
 * where a viz carries bindings, view params and asset refs). A story's `viz`
 * prop is the flat form, because a story artifact has none of that — its data
 * comes from a `ref:` and nothing else.
 *
 * Keeping the conversion in one pure module means the panel never reasons about
 * two shapes, and the round trip is testable without a browser. It is
 * deliberately LOSSLESS for the fields a story uses and drops the reserved
 * namespaces on the way back, so an edit cannot smuggle unsupported keys into a
 * stored artifact.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { isBlankSpec } from './encoding-edit';
import type { VizColumnKind } from './types';

/** The flat shape stored in `<Question viz={…}>`. */
export interface QuestionVizProp {
  kind: string;
  spec?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Chart kinds the panel can edit. Anything else is left to code mode. */
const EDITABLE_KINDS = new Set(['vega-lite']);

export function isEditableVizProp(viz: unknown): viz is QuestionVizProp {
  const kind = (viz as QuestionVizProp | undefined)?.kind;
  // A missing viz IS editable: it renders a table, and choosing a chart type is
  // exactly how a reader turns that into one.
  return viz === undefined || viz === null || (typeof kind === 'string' && EDITABLE_KINDS.has(kind));
}

/**
 * Lift a stored prop into an envelope the encoding helpers understand. A
 * missing or table-shaped prop becomes an empty vega-lite unit spec, so the
 * panel always has something to edit rather than special-casing "no chart yet".
 */
export function vizPropToEnvelope(viz: unknown): VizEnvelope {
  const prop = (viz ?? {}) as QuestionVizProp;
  const spec = (prop.spec ?? {}) as Record<string, unknown>;
  return {
    version: 2,
    source: { kind: 'vega-lite', spec },
    dataBindings: null,
    viewParams: null,
    interactions: null,
    assets: null,
  } as VizEnvelope;
}

/**
 * Flatten an envelope back to the stored prop.
 *
 * Returns `undefined` for a BLANK spec (no mark, no encoding, no composition —
 * `isBlankSpec`) — that is the "no chart" state, and a `<Question>` with no
 * `viz` renders the themed table. Writing `{kind:'vega-lite', spec:{}}` instead
 * would render an empty chart frame, which looks broken rather than deliberate.
 * A composed spec (layer/facet/concat) carries its marks a level down and must
 * NOT read as blank — that turned one spec-box apply into a vanished chart.
 */
export function envelopeToVizProp(envelope: VizEnvelope): QuestionVizProp | undefined {
  const source = (envelope as { source?: { kind?: string; spec?: Record<string, unknown> } }).source;
  const spec = source?.spec ?? {};
  if (isBlankSpec(spec)) return undefined;
  return { kind: source?.kind ?? 'vega-lite', spec };
}

/**
 * A dataset column's stored type → the Vega-Lite kind an encoding needs.
 *
 * Two vocabularies meet here: datasets record `string|number|boolean|date`
 * (what CSV coercion decided), and Vega-Lite encodings speak
 * `nominal|quantitative|temporal|boolean`. Getting this wrong is not cosmetic —
 * a quantitative encoding over a nominal column renders a flat or absent scale,
 * which is the silent-wrongness this whole tier avoids.
 */
export function datasetTypeToVizKind(type: string | undefined): VizColumnKind {
  switch (type) {
    case 'number': return 'quantitative';
    case 'date': return 'temporal';
    case 'boolean': return 'boolean';
    case 'string': return 'nominal';
    default: return 'unknown';
  }
}

/** A dataset column in the form the encoding helpers expect. */
export function vizColumn(name: string, type: string | undefined): { name: string; kind: VizColumnKind } {
  return { name, kind: datasetTypeToVizKind(type) };
}
