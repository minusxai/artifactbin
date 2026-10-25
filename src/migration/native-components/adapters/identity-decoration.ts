import type { NativeJson, RetainedJsxNode } from '../analyze-contracts.ts';
import type { RetainedAttribute, RetainedStaticValue } from '../analyze-contracts.ts';
import type { NativeLowerBlocker } from '../lower.ts';
import type { NativeComponentRule } from '../component-map.ts';

/** Pinned lower adapter output. The source graph identity and child tree remain authoritative. */
export interface NativeIdentityDecorationPlan {
  node: RetainedJsxNode;
  blockers: readonly NativeLowerBlocker[];
}

/**
 * Source Icon maps to the pinned product `icon.ts` custom element. Source
 * Separator stays an ordinary div and uses the retained React DOM recipe:
 * horizontal/decorative by default, with its original `shrink-0 bg-border`
 * recipe class preserved from the source class attribute/style receipt.
 */
export const NATIVE_IDENTITY_DECORATION_RULES: readonly NativeComponentRule[] = [
  {
    tag: 'Icon', htmlTag: 'af-icon', kind: 'native', module: 'icon', register: 'registerIcon',
    attributes: {
      name: 'string', size: 'string', 'stroke-width': 'string', theme: ['light', 'dark', 'auto'], label: 'string',
    },
    properties: [],
  },
  {
    tag: 'Separator', htmlTag: 'div', kind: 'semantic',
    attributes: {
      orientation: ['horizontal', 'vertical'], decorative: 'boolean',
      'data-orientation': 'string', 'aria-orientation': 'string', role: 'string', 'data-slot': 'string',
    },
    properties: [],
  },
];

const blocker = (node: RetainedJsxNode, code: string, attribute: string, detail: string): NativeLowerBlocker => ({
  code, sourceNode: node.graphKey, tag: node.type === 'element' ? node.tag : undefined, attribute, detail,
});

const SEPARATOR_RECIPE_CLASS = 'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px';
const staticValue = (json: NativeJson): RetainedStaticValue => ({ static: true, json });
const generatedAttribute = (node: Extract<RetainedJsxNode, { type: 'element' }>, name: string, json: NativeJson): RetainedAttribute => ({
  name, value: staticValue(json), start: node.start, end: node.start,
});

function prepareIcon(node: Extract<RetainedJsxNode, { type: 'element' }>): NativeIdentityDecorationPlan {
  const blockers: NativeLowerBlocker[] = [];
  const attributes = node.attributes;
  const byName = new Map<string, RetainedAttribute[]>();
  for (const attribute of attributes) byName.set(attribute.name, [...(byName.get(attribute.name) ?? []), attribute]);
  for (const [name, found] of byName) if (found.length > 1) blockers.push(blocker(node, 'identity-icon-attribute-conflict', name, 'Duplicate source icon props are ambiguous and are preserved unchanged'));

  const name = byName.get('name')?.[0];
  if (!name) blockers.push(blocker(node, 'identity-icon-name-required', 'name', 'Source Icon requires a literal glyph name; no fallback name is invented'));
  else if (!name.value.static) blockers.push(blocker(node, 'identity-icon-name-unsupported', 'name', 'Dynamic or non-string glyph names are not covered by the captured icon resolver'));
  else if (typeof name.value.json !== 'string') blockers.push(blocker(node, 'identity-icon-name-unsupported', 'name', 'Dynamic or non-string glyph names are not covered by the captured icon resolver'));

  // The source resolver supplies only the glyphs a document uses and may also
  // load an authored extension. AfIcon instead resolves its own pinned catalog;
  // silently discarding either source would change custom glyph semantics.
  if (byName.has('glyphs')) blockers.push(blocker(node, 'identity-icon-source-glyphs-unsupported', 'glyphs', 'The source glyph map has no exact catalog-equivalence receipt for the pinned local Lucide catalog'));
  if (byName.has('catalogUrl')) blockers.push(blocker(node, 'identity-icon-source-catalog-unsupported', 'catalogUrl', 'The target icon does not load a source-provided glyph catalog'));
  for (const prop of ['title', 'role', 'aria-hidden', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'focusable', 'tabIndex', 'class']) {
    if (byName.has(prop)) blockers.push(blocker(node, 'identity-icon-svg-attribute-unsupported', prop, 'The source applies this prop to the SVG while AfIcon owns an internal SVG with a different forwarding/default contract'));
  }
  if (node.children.some(child => child.type !== 'text' || child.value.trim() !== '')) {
    blockers.push(blocker(node, 'identity-icon-children-unsupported', 'children', 'Source Icon renders its resolved glyph, while AfIcon retains authored host children'));
  }

  const width = byName.get('width')?.[0];
  const height = byName.get('height')?.[0];
  const size = byName.get('size')?.[0];
  let normalizedSize: string | undefined;
  if (width || height) {
    const positiveDimension = (attribute: RetainedAttribute | undefined): string | undefined => {
      if (!attribute?.value.static) return undefined;
      const value = attribute.value.json;
      if (typeof value !== 'string' && typeof value !== 'number') return undefined;
      const text = String(value).trim();
      return /^(?:\d+(?:\.\d+)?)(?:px|em|rem|ch|vw|vh|%)?$/.test(text) && Number.parseFloat(text) > 0 ? text : undefined;
    };
    const widthText = positiveDimension(width);
    const heightText = positiveDimension(height);
    if (!width || !height || !widthText || !heightText || widthText !== heightText) {
      if (width) blockers.push(blocker(node, 'identity-icon-size-conflict', 'width', 'AfIcon has one square size property; independent or invalid source width cannot be preserved'));
      if (height) blockers.push(blocker(node, 'identity-icon-size-conflict', 'height', 'AfIcon has one square size property; independent or invalid source height cannot be preserved'));
      if (size && size.value.static && (typeof size.value.json === 'string' || typeof size.value.json === 'number') && widthText && String(size.value.json).trim() !== widthText) {
        blockers.push(blocker(node, 'identity-icon-size-conflict', 'size', 'Source size conflicts with the authored SVG width'));
      }
    } else if (size) {
      const sizeText = size.value.static && (typeof size.value.json === 'string' || typeof size.value.json === 'number') ? String(size.value.json).trim() : undefined;
      if (sizeText !== widthText) blockers.push(blocker(node, 'identity-icon-size-conflict', 'size', 'Source SVG width/height conflict with the target size property'));
      else normalizedSize = widthText;
    } else normalizedSize = widthText;
  }
  if (size && !size.value.static) blockers.push(blocker(node, 'identity-icon-size-unsupported', 'size', 'Dynamic size cannot be normalized to the observed AfIcon size attribute'));
  if (size?.value.static && typeof size.value.json !== 'string' && typeof size.value.json !== 'number') blockers.push(blocker(node, 'identity-icon-size-unsupported', 'size', 'AfIcon size accepts only a string or finite number'));
  if (size?.value.static && typeof size.value.json === 'number' && !Number.isFinite(size.value.json)) blockers.push(blocker(node, 'identity-icon-size-unsupported', 'size', 'AfIcon size must be finite'));
  if (size?.value.static && (typeof size.value.json === 'string' || typeof size.value.json === 'number') && normalizedSize !== undefined && String(size.value.json).trim() !== normalizedSize) {
    blockers.push(blocker(node, 'identity-icon-size-conflict', 'size', 'Source width/height conflict with the target size property'));
  }
  const strokeWidth = byName.get('strokeWidth')?.[0];
  const strokeWidthAttr = byName.get('stroke-width')?.[0];
  if (strokeWidth && strokeWidthAttr) blockers.push(blocker(node, 'identity-icon-attribute-conflict', 'stroke-width', 'Both source strokeWidth spellings are present'));
  else if (strokeWidth && (!strokeWidth.value.static || !['string', 'number'].includes(typeof strokeWidth.value.json) || typeof strokeWidth.value.json === 'number' && !Number.isFinite(strokeWidth.value.json))) {
    blockers.push(blocker(node, 'identity-icon-stroke-width-unsupported', 'strokeWidth', 'strokeWidth must be a finite number or string'));
  }

  if (blockers.length) return { node, blockers };

  const output: RetainedAttribute[] = [];
  const sizeValue = normalizedSize ?? (size?.value.static ? String(size.value.json) : undefined);
  let sizeWritten = false;
  for (const attribute of attributes) {
    if (attribute.name === 'width' || attribute.name === 'height' || attribute.name === 'size') {
      if (sizeValue !== undefined && !sizeWritten) {
        output.push({ ...attribute, name: 'size', value: staticValue(sizeValue) });
        sizeWritten = true;
      }
      continue;
    }
    if (attribute.name === 'strokeWidth') {
      output.push({ ...attribute, name: 'stroke-width', value: staticValue(String(attribute.value.static ? attribute.value.json : '')) });
      continue;
    }
    output.push(attribute);
  }
  if (sizeValue !== undefined && !sizeWritten) output.push(generatedAttribute(node, 'size', sizeValue));
  return { node: { ...node, attributes: output }, blockers: [] };
}

function prepareSeparator(node: Extract<RetainedJsxNode, { type: 'element' }>): NativeIdentityDecorationPlan {
  const byName = new Map<string, RetainedAttribute[]>();
  for (const attribute of node.attributes) byName.set(attribute.name, [...(byName.get(attribute.name) ?? []), attribute]);
  const blockers: NativeLowerBlocker[] = [];
  for (const name of ['orientation', 'decorative']) {
    if ((byName.get(name)?.length ?? 0) > 1) blockers.push(blocker(node, 'identity-separator-prop-conflict', name, 'Duplicate Separator behavior props are ambiguous and remain unchanged'));
  }
  const orientation = byName.get('orientation')?.[0];
  const decorative = byName.get('decorative')?.[0];
  if (orientation) {
    if (!orientation.value.static) blockers.push(blocker(node, 'identity-separator-prop-unsupported', 'orientation', 'Dynamic orientation cannot be converted to a concrete retained DOM recipe'));
    else if (orientation.value.json !== 'horizontal' && orientation.value.json !== 'vertical') blockers.push(blocker(node, 'identity-separator-prop-unsupported', 'orientation', 'Expected horizontal or vertical orientation'));
  }
  if (decorative) {
    if (!decorative.value.static) blockers.push(blocker(node, 'identity-separator-prop-unsupported', 'decorative', 'Dynamic decorative state cannot be converted to a concrete retained DOM recipe'));
    else if (typeof decorative.value.json !== 'boolean') blockers.push(blocker(node, 'identity-separator-prop-unsupported', 'decorative', 'Expected an exact boolean decorative value'));
  }
  if (blockers.length) return { node, blockers };

  const axis = orientation?.value.static ? orientation.value.json as 'horizontal' | 'vertical' : 'horizontal';
  const isDecorative = decorative?.value.static ? decorative.value.json as boolean : true;
  const defaults: RetainedAttribute[] = [generatedAttribute(node, 'data-orientation', axis)];
  if (!isDecorative && axis === 'vertical') defaults.push(generatedAttribute(node, 'aria-orientation', 'vertical'));
  defaults.push(generatedAttribute(node, 'role', isDecorative ? 'none' : 'separator'));
  defaults.push(generatedAttribute(node, 'data-slot', 'separator'));

  // The original component spreads rest props last, so explicit role/data-* props
  // override its defaults. Preserve source order and any duplicate author attrs.
  const defaultNames = new Set(defaults.map(attribute => attribute.name));
  const firstSource = new Map<string, RetainedAttribute>();
  for (const attribute of node.attributes) if (defaultNames.has(attribute.name) && !firstSource.has(attribute.name)) firstSource.set(attribute.name, attribute);
  const output = defaults.map(attribute => firstSource.get(attribute.name) ?? attribute);
  const consumed = new Set<string>();
  for (const attribute of node.attributes) {
    if (attribute.name === 'orientation' || attribute.name === 'decorative') continue;
    if (defaultNames.has(attribute.name) && !consumed.has(attribute.name)) { consumed.add(attribute.name); continue; }
    output.push(attribute);
  }
  if (!byName.has('class') && !byName.has('className')) output.push(generatedAttribute(node, 'className', SEPARATOR_RECIPE_CLASS));
  return { node: { ...node, attributes: output }, blockers: [] };
}

export function prepareNativeIdentityDecoration(node: RetainedJsxNode): NativeIdentityDecorationPlan {
  if (node.type === 'element' && node.tag === 'Icon') return prepareIcon(node);
  if (node.type === 'element' && node.tag === 'Separator') return prepareSeparator(node);
  return { node, blockers: [] };
}
