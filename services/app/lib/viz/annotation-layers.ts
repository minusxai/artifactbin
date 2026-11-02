/** Recognize datum-only annotation layers around a native Vega-Lite unit. */
const COMPOSITION_KEYS = ['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec'];

function isUnitVegaLiteSpec(spec: Record<string, unknown>): boolean {
  return 'mark' in spec && !COMPOSITION_KEYS.some(k => k in spec);
}

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

function getMarkType(spec: Record<string, unknown>): string | null {
  const mark = spec.mark;
  if (typeof mark === 'string') return mark;
  if (mark && typeof mark === 'object') {
    const t = (mark as Record<string, unknown>).type;
    return typeof t === 'string' ? t : null;
  }
  return null;
}
