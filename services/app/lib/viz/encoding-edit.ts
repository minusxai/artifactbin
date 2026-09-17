/**
 * Targeted encoding edits for the drop-zone lens over unit Vega-Lite specs.
 *
 * The RFC's cardinal rule: the UI must never parse a spec into a simplified model and
 * rewrite it. These helpers make SURGICAL edits only — set/replace/remove one encoding
 * channel's field, preserving every other property of the channel (axis, title, scale)
 * and everything else in the spec. Composed specs (layer/facet/concat/repeat) are not
 * editable here; they're edited via chat.
 */
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizColumnKind } from './types';

const EDITABLE_CHANNELS = ['x', 'y', 'color', 'theta'] as const;
export type EditableChannel = (typeof EDITABLE_CHANNELS)[number];

const COMPOSITION_KEYS = ['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec'];

function isUnitVegaLiteSpec(spec: Record<string, unknown>): boolean {
  return 'mark' in spec && !COMPOSITION_KEYS.some(k => k in spec);
}

/**
 * The "no chart" state: no mark, no encoded channel, no composition operator.
 * The composition check is load-bearing — a layered spec carries its marks and
 * encodings one level down, so reading only the top level would call a real
 * chart blank (and the panel would then clear it to a table on the next edit).
 */
export function isBlankSpec(spec: Record<string, unknown>): boolean {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  const hasEncoding = !!encoding && Object.keys(encoding).length > 0;
  return !spec.mark && !hasEncoding && !COMPOSITION_KEYS.some(k => k in spec);
}

// ── Annotated-unit recognition (annotations "in the fold") ──────────────────────────
//
// A spec of shape {layer: [unit chart, ...annotation layers]} — where every extra layer
// is a datum-only rule/rect/text (reference lines + their badge labels, ours or
// agent-authored) — is still treated as its BASE chart everywhere: type detection, the
// drop-zone lens, settings toggles, the shared tooltip. Purely structural, so no stored
// format changes; a layer with any FIELD encoding keeps the spec genuinely custom.

/** A datum/value-only rule, rect, or text layer — annotation chrome, not a data mark. */
function isAnnotationLayer(layer: unknown): boolean {
  const l = layer && typeof layer === 'object' && !Array.isArray(layer) ? (layer as Record<string, unknown>) : null;
  if (!l) return false;
  const markType = getMarkType(l);
  if (markType !== 'rule' && markType !== 'rect' && markType !== 'text') return false;
  const encoding = l.encoding;
  if (encoding == null || typeof encoding !== 'object' || Array.isArray(encoding)) return false;
  return Object.values(encoding as Record<string, unknown>).every(def => {
    if (def == null || typeof def !== 'object' || Array.isArray(def)) return false;
    return !('field' in (def as Record<string, unknown>));
  });
}

/** Split base chart from annotation layers; null when the spec isn't unit-or-annotated. */
export function annotationSplit(
  spec: Record<string, unknown>,
): { unit: Record<string, unknown>; annotations: Record<string, unknown>[] } | null {
  if (isUnitVegaLiteSpec(spec)) return { unit: spec, annotations: [] };
  if (COMPOSITION_KEYS.some(k => k !== 'layer' && k in spec)) return null;
  const layers = spec.layer;
  if (!Array.isArray(layers) || layers.length < 2) return null;
  const [first, ...rest] = layers;
  const base = first && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>) : null;
  if (!base || !isUnitVegaLiteSpec(base)) return null;
  if (!rest.every(isAnnotationLayer)) return null;
  return { unit: base, annotations: rest as Record<string, unknown>[] };
}

/** The editable UNIT of a spec — itself, or the base layer of an annotated spec. */
export const unitOf = (spec: Record<string, unknown>): Record<string, unknown> | null =>
  annotationSplit(spec)?.unit ?? null;

/** unitOf with a pass-through fallback (edit helpers operate on whatever is there). */
const unitOrSelf = (spec: Record<string, unknown>): Record<string, unknown> =>
  unitOf(spec) ?? spec;

/** The column a channel encodes, or null when absent / not a plain field reference. */
export function getChannelField(spec: Record<string, unknown>, channel: EditableChannel): string | null {
  const encoding = unitOrSelf(spec).encoding as Record<string, Record<string, unknown>> | undefined;
  const def = encoding?.[channel];
  return def && typeof def.field === 'string' ? def.field : null;
}

const KIND_TO_VL_TYPE: Record<VizColumnKind, string> = {
  quantitative: 'quantitative',
  temporal: 'temporal',
  nominal: 'nominal',
  boolean: 'nominal',
  unknown: 'nominal',
};

/**
 * Return a NEW envelope with `channel` encoding `column` (or removed when null).
 * Replaces only `field` + `type` on an existing channel def — its other props
 * (axis, title, scale, format…) survive. Everything else in the spec is untouched.
 */
export function setChannelField(
  envelope: VizEnvelope,
  channel: EditableChannel,
  column: { name: string; kind: VizColumnKind } | null,
): VizEnvelope {
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  const unit = unitOrSelf((next.source as { spec: Record<string, unknown> }).spec);
  const encoding = { ...(unit.encoding as Record<string, unknown> | undefined) } as Record<string, unknown>;
  if (column == null) {
    delete encoding[channel];
  } else {
    const existing = encoding[channel];
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
    // Heatmap rule (rect marks): x/y are DISCRETE bands. A temporal type would go
    // continuous and collapse the rows into one giant rect per category — the same
    // temporal→ordinal mapping the pivot→heatmap transform applies.
    const rectAxis = (channel === 'x' || channel === 'y') && getMarkType(unit) === 'rect';
    const vlType = rectAxis && column.kind === 'temporal' ? 'ordinal' : KIND_TO_VL_TYPE[column.kind];
    const def: Record<string, unknown> = { ...base, field: column.name, type: vlType };
    // A previous datum/value literal on this channel would fight the new field ref.
    delete def.datum;
    delete def.value;
    encoding[channel] = def;
  }
  unit.encoding = encoding;
  return next;
}

// ── Settings-tab surgical edits (same rule: one property, everything else survives) ──

const cloneEnvelope = (envelope: VizEnvelope): { next: VizEnvelope; spec: Record<string, unknown> } => {
  const next = JSON.parse(JSON.stringify(envelope)) as VizEnvelope;
  return { next, spec: (next.source as { spec: Record<string, unknown> }).spec };
};

const channelDef = (spec: Record<string, unknown>, channel: string): Record<string, unknown> | null => {
  const def = (unitOrSelf(spec).encoding as Record<string, unknown> | undefined)?.[channel];
  return def && typeof def === 'object' && !Array.isArray(def) ? (def as Record<string, unknown>) : null;
};

function getMarkType(spec: Record<string, unknown>): string | null {
  const mark = spec.mark;
  if (typeof mark === 'string') return mark;
  if (mark && typeof mark === 'object') {
    const t = (mark as Record<string, unknown>).type;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

// ── Viz-type switching (the icon selector) ─────────────────────────────────────────
//
// Cartesian marks are interchangeable (same positional encodings) — pure mark swaps.
// `row` swaps the x/y defs wholesale so axis/format config travels with the channel.
// `pie` is an encoding TRANSFORM: a naive mark swap to `arc` renders garbage because
// arcs read theta/color, not x/y.

const V2_SUPPORTED_VIZ_TYPES = ['table', 'pivot', 'bar', 'line', 'area', 'scatter', 'pie', 'row', 'combo', 'funnel', 'waterfall', 'radar', 'heatmap', 'boxplot', 'trend', 'single_value', 'histogram', 'choropleth', 'point_map'] as const;
type V2VizType = (typeof V2_SUPPORTED_VIZ_TYPES)[number];

const MARK_FOR_TYPE: Record<Exclude<V2VizType, 'table' | 'pivot' | 'row' | 'pie' | 'heatmap' | 'combo' | 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'histogram' | 'choropleth' | 'point_map'>, string> = {
  bar: 'bar', line: 'line', area: 'area', scatter: 'point', boxplot: 'boxplot',
};

/** Classify a unit (or annotated-unit) spec into a selector viz type (null when unrecognized). */
export function getVizType(spec: Record<string, unknown>): V2VizType | null {
  spec = unitOrSelf(spec);
  const mark = getMarkType(spec);
  if (mark === 'arc') return 'pie';
  if (mark === 'rect') return 'heatmap';
  if (mark === 'point') return 'scatter';
  if (mark === 'boxplot') return 'boxplot';
  if (mark === 'bar') {
    const x = channelDef(spec, 'x');
    const y = channelDef(spec, 'y');
    // Histogram = a binned x (distribution plot). Checked before row: a binned x
    // is quantitative and would misread as a plain bar.
    if (x != null && x.bin != null && x.bin !== false) return 'histogram';
    // Row = horizontal bar: the measure runs along x, the category/time along y.
    if (x?.type === 'quantitative' && y != null && y.type !== 'quantitative') return 'row';
    return 'bar';
  }
  if (mark === 'line' || mark === 'area') return mark;
  return null;
}

const withMark = (spec: Record<string, unknown>, type: string): void => {
  spec.mark = typeof spec.mark === 'object' && spec.mark != null
    ? { ...(spec.mark as Record<string, unknown>), type }
    : { type };
};

/** Native-spec viz types (recipes and the DOM-tier table/pivot route through setEnvelopeVizType instead). */
type SpecVizType = Exclude<V2VizType, 'table' | 'pivot' | 'combo' | 'funnel' | 'waterfall' | 'radar' | 'trend' | 'single_value' | 'choropleth' | 'point_map'>;

/** Switch a unit (or annotated-unit) spec's viz type, transforming encodings where the
 *  shapes differ. Annotation layers ride along untouched. */
export function setVizType(envelope: VizEnvelope, type: SpecVizType): VizEnvelope {
  const { next, spec: outerSpec } = cloneEnvelope(envelope);
  const spec = unitOrSelf(outerSpec);
  const encoding = { ...((spec.encoding as Record<string, unknown> | undefined) ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const from = getVizType(spec);

  // Leaving pie: the slice category (color) becomes the x-axis, theta becomes y. Keep the
  // color too (bar/scatter render nicely coloured by category); the redundant-color cleanup
  // below drops it for line/area, where color === x would break the connecting line.
  if (from === 'pie' && type !== 'pie') {
    if (encoding.color && !encoding.x) encoding.x = { ...encoding.color };
    if (encoding.theta && !encoding.y) encoding.y = { ...encoding.theta };
    delete encoding.theta;
  }

  // Leaving histogram: the measure lives on binned x (count on y) — restore it to
  // y (bin stripped). The original category was dropped entering histogram, so x
  // stays empty; the user re-adds one via the zones.
  if (from === 'histogram' && type !== 'histogram') {
    const measure = encoding.x ? { ...encoding.x } : undefined;
    delete encoding.x;
    delete encoding.y; // the implicit count def
    if (measure) {
      delete measure.bin;
      encoding.y = measure;
    }
  }

  // Leaving heatmap: the measure lives on color and the second category on y —
  // restore the cartesian shape (measure → y, category → color/series).
  if (from === 'heatmap' && type !== 'heatmap') {
    const measure = encoding.color;
    const series = encoding.y;
    if (measure) encoding.y = { ...measure };
    if (series) encoding.color = { ...series };
    else delete encoding.color;
  }

  if (type === 'pie') {
    const value = encoding.y ?? encoding.theta;
    const slice = encoding.color ?? encoding.x;
    if (value) {
      const theta = { ...value };
      delete theta.axis; // meaningless on theta
      delete theta.stack;
      // VL draws one arc per DATUM — un-aggregated multi-row results become
      // hundreds of slivers per category. SUM matches the classic pipeline.
      if (theta.aggregate == null) theta.aggregate = 'sum';
      encoding.theta = theta;
    }
    if (slice) encoding.color = { ...slice };
    delete encoding.x;
    delete encoding.y;
    // Any remaining non-aggregated field channel joins the aggregate groupby and
    // re-shards the arcs (e.g. a weekly tooltip → 140 slivers per slice). Automatic
    // tooltips (theme) cover the donut; authors can re-add a custom list via chat.
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    // Minimal mark only — the house donut styling (responsive innerRadius, rounded,
    // padded) is the theme's config.arc, so this saved spec stays identical to what
    // an agent authors and both render the same.
    withMark(spec, 'arc');
  } else if (type === 'heatmap') {
    // Heatmap = two discrete axes + the measure as colour. The y measure moves
    // to color (SUM-aggregated like pie), the colour series (if any) becomes y.
    const measure = encoding.y;
    const series = encoding.color;
    if (measure) {
      const color = { ...measure };
      delete color.axis;
      delete color.stack;
      if (color.aggregate == null) color.aggregate = 'sum';
      encoding.color = color;
    }
    if (series) {
      const y = { ...series };
      delete y.scale; // colour scales (scheme/range) are meaningless on an axis
      encoding.y = y;
    } else {
      delete encoding.y;
    }
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    withMark(spec, 'rect');
  } else if (type === 'histogram') {
    // Histogram = distribution plot: the measure binned along x, record count on
    // y, optional discrete colour split. Coming from row the measure sits on x —
    // normalize to the vertical shape first.
    if (from === 'row') {
      const x = encoding.x;
      encoding.x = encoding.y;
      encoding.y = x;
    }
    const measure = encoding.y;
    if (measure) {
      const x = { ...measure };
      delete x.aggregate; // bin and aggregate fight; the histogram aggregates by COUNT
      delete x.stack;
      x.bin = true;
      x.type = 'quantitative';
      encoding.x = x; // the measure's presentation (axis, title…) travels to the values axis
    } else {
      delete encoding.x; // no measure to bin — the category axis means nothing here
    }
    encoding.y = { aggregate: 'count', type: 'quantitative' };
    // Non-aggregated field channels would join the count groupby and re-shard the
    // bins (same rule as pie/heatmap); automatic tooltips cover the bars.
    delete encoding.tooltip;
    delete encoding.detail;
    delete encoding.order;
    withMark(spec, 'bar');
  } else if (type === 'row') {
    const x = encoding.x;
    encoding.x = encoding.y;
    encoding.y = x;
    withMark(spec, 'bar');
  } else {
    // Coming FROM row, restore vertical orientation (swap back).
    if (from === 'row') {
      const x = encoding.x;
      encoding.x = encoding.y;
      encoding.y = x;
    }
    // The boxplot composite mark aggregates internally (q1/median/q3/whiskers) —
    // a pre-aggregated y feeds ONE value per group (degenerate box), and stack is
    // meaningless on it. Presentation props (axis, title…) survive.
    if (type === 'boxplot' && encoding.y) {
      encoding.y = { ...encoding.y };
      delete encoding.y.aggregate;
      delete encoding.y.stack;
    }
    withMark(spec, MARK_FOR_TYPE[type]);
  }

  // The donut props only make sense on arcs — strip them when leaving pie.
  if (type !== 'pie' && spec.mark && typeof spec.mark === 'object') {
    const mark = spec.mark as Record<string, unknown>;
    delete mark.innerRadius;
    delete mark.cornerRadius;
    delete mark.padAngle;
  }

  // Channel hygiene: a def moved between channels must not carry a property that's invalid
  // on its new channel. `legend` belongs to color/size/shape, NOT positional x/y (Vega-Lite
  // silently renders NOTHING for `x: {…, legend}` — e.g. the pie→bar switch, whose x is
  // copied from the pie's `color`). `axis` is the reverse (positional-only) on color.
  for (const ch of ['x', 'y'] as const) {
    const d = encoding[ch];
    if (d && typeof d === 'object' && !Array.isArray(d)) delete (d as Record<string, unknown>).legend;
  }
  const colorDef = encoding.color as Record<string, unknown> | undefined;
  if (colorDef && typeof colorDef === 'object' && !Array.isArray(colorDef)) delete colorDef.axis;

  // A color that duplicates the x field is redundant everywhere and BREAKS line/area:
  // color === x splits the data into single-point series → isolated dots, no line. Drop it
  // for line/area (bar/scatter keep it — coloured-by-category is a fine look there).
  if ((type === 'line' || type === 'area') && colorDef?.field != null
    && colorDef.field === (encoding.x as Record<string, unknown> | undefined)?.field) {
    delete encoding.color;
  }

  for (const key of Object.keys(encoding)) if (encoding[key] === undefined) delete encoding[key];
  spec.encoding = encoding;
  return next;
}

/**
 * The drop zones a viz type actually uses — per-type, so a pie never offers
 * positional channels (assigning x/y to an arc draws overlapping wedges per position).
 */
export function zonesForVizType(type: V2VizType | null): Array<{ channel: EditableChannel; label: string }> {
  if (type === 'heatmap') {
    return [
      { channel: 'x', label: 'X-Axis' },
      { channel: 'y', label: 'Y-Axis' },
      { channel: 'color', label: 'Value' },
    ];
  }
  if (type === 'pie') {
    return [
      { channel: 'color', label: 'Slices' },
      { channel: 'theta', label: 'Value' },
    ];
  }
  if (type === 'histogram') {
    // y is the implicit record count — only the binned measure and the split are
    // author-assignable.
    return [
      { channel: 'x', label: 'Values' },
      { channel: 'color', label: 'Color / Split' },
    ];
  }
  return [
    { channel: 'x', label: 'X-Axis' },
    { channel: 'y', label: 'Y-Axis' },
    { channel: 'color', label: 'Color / Series' },
  ];
}
