import {isNativeSvgRevealMarker} from '../svg-marker-contracts.ts';
import type { RetainedJsxNode, RetainedStaticValue } from '../analyze-contracts.ts';
import type { NativeLowerBlocker } from '../lower.ts';

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg' as const;

/** SVG elements supported by the ordinary-markup adapter. Names stay case-sensitive. */
export const SVG_TAGS: ReadonlySet<string> = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc', 'defs', 'symbol', 'marker', 'linearGradient', 'radialGradient',
  'stop', 'clipPath', 'mask',
]);

/** Exact source attribute spellings accepted for static SVG. URL-bearing attrs are omitted. */
export const SVG_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id', 'class', 'className', 'role', 'tabIndex', 'focusable', 'xmlns', 'data-reveal',
  'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'fill', 'fillRule', 'fillOpacity', 'stroke', 'clipPath', 'mask',
  'markerStart', 'markerMid', 'markerEnd', 'letterSpacing',
  'strokeWidth', 'strokeOpacity', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray',
  'strokeDashoffset', 'opacity', 'transform', 'd', 'points', 'pathLength', 'offset',
  'stopColor', 'stopOpacity', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY',
  'orient', 'preserveAlpha', 'clipRule', 'vectorEffect', 'shapeRendering',
  'textAnchor', 'dominantBaseline', 'fontFamily', 'fontSize', 'fontWeight',
  'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-describedby',
]);

/** Metadata elements may be lifted only while traversal is inside an authored Helmet. */
export const HEAD_METADATA_TAGS: ReadonlySet<string> = new Set(['meta', 'title']);

const META_ATTRIBUTES: ReadonlySet<string> = new Set([
  'name', 'content', 'property', 'charSet', 'httpEquiv', 'itemProp', 'media',
]);
const URL_TEXT = /(?:^|[\s"'(])(?:javascript|data|vbscript):|url\s*\(|\\|\/\//i;
const PATH_DATA = /^[\s,0-9eE+\-.MmZzLlHhVvCcSsQqTtAa]*$/;
const POINT_DATA = /^[\s,0-9eE+\-.]*$/;
const FRAGMENT_REFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set(['clipPath', 'fill', 'stroke', 'markerStart', 'markerMid', 'markerEnd', 'mask']);
const LOCAL_FRAGMENT = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)$/;
const VIEWBOX = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

export interface NativeDocumentMarkupContext { inHead: boolean; svgNamespace: boolean; fragmentIds?: readonly string[] }
export interface NativeDocumentMarkupPlan {
  node: RetainedJsxNode;
  namespace?: typeof SVG_NAMESPACE;
  headOnly?: boolean;
  blockers: readonly NativeLowerBlocker[];
}

function blocker(node: Extract<RetainedJsxNode, { type: 'element' }>, code: string, detail: string, attribute?: string): NativeLowerBlocker {
  return { code, sourceNode: node.graphKey, tag: node.tag, ...(attribute ? { attribute } : {}), detail };
}
function staticPrimitive(value: RetainedStaticValue): unknown {
  return value.static ? value.json : undefined;
}
function hasUnsafeText(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || URL_TEXT.test(value);
}

/**
 * Pure source-preserving admission for ordinary SVG and Helmet metadata nodes.
 * It never evaluates JSX expressions or rewrites source attributes/children.
 */
export function prepareNativeDocumentMarkup(
  node: RetainedJsxNode,
  context: NativeDocumentMarkupContext,
): NativeDocumentMarkupPlan {
  if (node.type !== 'element') return { node, blockers: [] };
  const blockers: NativeLowerBlocker[] = [];

  if (HEAD_METADATA_TAGS.has(node.tag) && !context.svgNamespace) {
    if (!context.inHead) {
      blockers.push(blocker(node, 'metadata-outside-helmet', 'Head metadata must be authored inside Helmet; it cannot remain in the body.'));
      return { node, blockers };
    }
    if (node.tag === 'meta') {
      for (const attribute of node.attributes) {
        if (!META_ATTRIBUTES.has(attribute.name)) {
          blockers.push(blocker(node, 'metadata-attribute-unsupported', 'Metadata attribute is outside the safe head metadata allowlist.', attribute.name));
          continue;
        }
        const value = staticPrimitive(attribute.value);
        if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (attribute.name === 'httpEquiv' && value.trim().toLowerCase() === 'refresh')) {
          blockers.push(blocker(node, 'metadata-value-unsupported', 'Metadata values must be static text; refresh directives are unsupported.', attribute.name));
        }
      }
    } else if (node.attributes.length > 0) {
      blockers.push(blocker(node, 'metadata-attribute-unsupported', 'title does not accept authored attributes.'));
    }
    return { node, headOnly: true, blockers };
  }

  const isSvgRoot = node.tag === 'svg';
  const isSvgChild = context.svgNamespace;
  if (!isSvgRoot && !isSvgChild) return { node, blockers };

  if (!SVG_TAGS.has(node.tag)) {
    blockers.push(blocker(node, 'svg-tag-unsupported', 'SVG element is outside the explicit safe SVG tag allowlist.'));
    return { node, blockers };
  }

  for (const attribute of node.attributes) {
    if (/^on/i.test(attribute.name)) {
      blockers.push(blocker(node, 'svg-executable-attribute', 'SVG event-handler attributes are not supported.', attribute.name));
      continue;
    }
    if (!SVG_ATTRIBUTES.has(attribute.name) && !/^aria-[a-z][a-z0-9-]*$/.test(attribute.name)) {
      blockers.push(blocker(node, 'svg-attribute-unsupported', 'SVG attribute is outside the explicit safe allowlist.', attribute.name));
      continue;
    }
    const value = staticPrimitive(attribute.value);
    if(attribute.name==='data-reveal'){
      if(!isSvgRoot||!isNativeSvgRevealMarker(value))blockers.push(blocker(node,'svg-reveal-marker-unsupported','SVG reveal markers require an exact static boolean on the SVG root.',attribute.name));
      continue;
    }
    if (typeof value === 'string') {
      if (attribute.name === 'xmlns') {
        if (value !== SVG_NAMESPACE) blockers.push(blocker(node, 'svg-namespace-unsupported', 'Only the standard SVG namespace declaration is supported.', attribute.name));
        continue;
      }
      if (FRAGMENT_REFERENCE_ATTRIBUTES.has(attribute.name) && /url\s*\(/i.test(value)) {
        const reference = LOCAL_FRAGMENT.exec(value);
        if (!reference) {
          blockers.push(blocker(node, 'svg-url-or-control-value-unsupported', 'Only an exact local SVG fragment reference is supported.', attribute.name));
        } else if (!context.fragmentIds?.includes(reference[1]!)) {
          blockers.push(blocker(node, 'svg-fragment-target-unresolved', 'Local SVG fragment references require an exact admitted target ID.', attribute.name));
        }
        continue;
      }
      if (hasUnsafeText(value)) {
        blockers.push(blocker(node, 'svg-url-or-control-value-unsupported', 'SVG value contains an unsupported URL or control sequence.', attribute.name));
        continue;
      }
      if (attribute.name === 'd' && !PATH_DATA.test(value)) {
        blockers.push(blocker(node, 'svg-path-data-unsupported', 'SVG path data contains unsupported syntax.', attribute.name));
        continue;
      }
      if (attribute.name === 'points' && !POINT_DATA.test(value)) {
        blockers.push(blocker(node, 'svg-points-unsupported', 'SVG points must be static numeric coordinate text.', attribute.name));
        continue;
      }
      if (attribute.name === 'viewBox' && (!VIEWBOX.test(value) || !VIEWBOX.exec(value)?.slice(1).every(part => Number.isFinite(Number(part))))) {
        blockers.push(blocker(node, 'svg-viewbox-unsupported', 'viewBox must be four static finite numbers; its original spelling is preserved.', attribute.name));
        continue;
      }
    } else if (typeof value === 'number' ? !Number.isFinite(value) : typeof value === 'boolean' ? !['focusable', 'aria-hidden'].includes(attribute.name) : true) {
      blockers.push(blocker(node, 'svg-dynamic-attribute-unsupported', 'SVG attributes must be safe static strings, finite numbers, or permitted booleans.', attribute.name));
    }
  }

  return { node, ...(isSvgRoot ? { namespace: SVG_NAMESPACE } : {}), blockers };
}
