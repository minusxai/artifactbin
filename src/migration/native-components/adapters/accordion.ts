import type { RetainedJsxNode, RetainedStaticValue } from '../analyze-contracts.ts';
import type { NativeLowerBlocker } from '../lower.ts';
import type { NativeComponentRule } from '../component-map.ts';

const MODULE = 'accordion';
const REGISTER = 'registerAccordion';
const FAMILY = new Set(['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent']);

/** Rules copied from the pinned native accordion module's public component contract. */
export const NATIVE_ACCORDION_RULES: readonly NativeComponentRule[] = [
  {
    tag: 'Accordion', htmlTag: 'af-accordion', kind: 'native', module: MODULE, register: REGISTER,
    attributes: {
      type: ['single', 'multiple'], collapsible: 'boolean', disabled: 'boolean',
      defaultValue: 'string', orientation: ['vertical', 'horizontal'],
    },
    properties: ['value'],
  },
  {
    tag: 'AccordionItem', htmlTag: 'af-accordion-item', kind: 'native', module: MODULE, register: REGISTER,
    attributes: { value: 'string', disabled: 'boolean' }, parent: ['Accordion'],
  },
  {
    tag: 'AccordionTrigger', htmlTag: 'af-accordion-trigger', kind: 'native', module: MODULE, register: REGISTER,
    attributes: { disabled: 'boolean' }, parent: ['AccordionItem'],
  },
  {
    tag: 'AccordionContent', htmlTag: 'af-accordion-content', kind: 'native', module: MODULE, register: REGISTER,
    attributes: {}, parent: ['AccordionItem'],
  },
];

type AccordionMode = 'single' | 'multiple';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string');

function blocker(node: RetainedJsxNode, attribute: string, detail: string): NativeLowerBlocker {
  return { code: 'accordion-prop-unsupported', sourceNode: node.graphKey, tag: 'Accordion', attribute, detail };
}

function normalizedValue(mode: AccordionMode, value: unknown): string | string[] | undefined {
  if (value === null) return mode === 'multiple' ? [] : '';
  if (typeof value === 'string') {
    if (mode === 'single') return value;
    return value ? [value] : [];
  }
  if (!isStringArray(value)) return undefined;
  if (mode === 'single') return value[0] ?? '';
  return [...new Set(value.filter(Boolean))];
}

function staticValue(value: string): RetainedStaticValue {
  return { static: true, json: value };
}

/**
 * Normalize source Accordion props for the reviewed `af-accordion` module.
 * Source tags, graph identity, spans and child order remain owned by the source.
 */
export function prepareNativeAccordion<T extends RetainedJsxNode>(node: T): {
  node: T;
  blockers: readonly NativeLowerBlocker[];
} {
  if (node.type !== 'element' || node.tag !== 'Accordion') return { node, blockers: [] };

  const blockers: NativeLowerBlocker[] = [];
  const attributes = node.attributes.map(attribute => ({
    ...attribute,
    value: { ...attribute.value } as RetainedStaticValue,
  }));
  const byName = new Map<string, typeof attributes[number]>();
  for (const attribute of attributes) {
    if (byName.has(attribute.name)) blockers.push(blocker(node, attribute.name, 'Duplicate source properties are ambiguous'));
    else byName.set(attribute.name, attribute);
  }

  const typeAttribute = byName.get('type');
  const multipleAttribute = byName.get('multiple');
  const typeValue = typeAttribute?.value.static ? typeAttribute.value.json : undefined;
  const multipleValue = multipleAttribute?.value.static ? multipleAttribute.value.json : undefined;
  if (typeAttribute && !typeAttribute.value.static) {
    blockers.push(blocker(node, 'type', 'Dynamic type cannot be normalized without a reviewed binding adapter'));
  }
  if (multipleAttribute && !multipleAttribute.value.static) {
    blockers.push(blocker(node, 'multiple', 'Dynamic multiple mode cannot be normalized without a reviewed binding adapter'));
  }
  if (typeAttribute?.value.static && typeValue !== 'single' && typeValue !== 'multiple') {
    blockers.push(blocker(node, 'type', 'Expected the exact value single or multiple'));
  }
  if (multipleAttribute?.value.static && typeof multipleValue !== 'boolean') {
    blockers.push(blocker(node, 'multiple', 'Expected a boolean multiple flag'));
  }
  const explicitType = typeValue === 'single' || typeValue === 'multiple' ? typeValue : undefined;
  const aliasType = typeof multipleValue === 'boolean' ? (multipleValue ? 'multiple' : 'single') : undefined;
  if (explicitType && aliasType && explicitType !== aliasType) {
    blockers.push(blocker(node, 'multiple', 'multiple conflicts with the explicit type'));
  }
  const mode: AccordionMode = explicitType ?? aliasType ?? 'single';

  const collapsible = byName.get('collapsible');
  if (collapsible && (!collapsible.value.static || typeof collapsible.value.json !== 'boolean')) {
    blockers.push(blocker(node, 'collapsible', 'Expected a literal boolean collapsible value'));
  }

  const value = byName.get('value');
  if (value?.value.static) {
    const normalized = normalizedValue(mode, value.value.json);
    if (normalized === undefined) blockers.push(blocker(node, 'value', 'Expected a string, string array, or null controlled value'));
    else value.value = { static: true, json: normalized };
  }

  const defaultValue = byName.get('defaultValue');
  if (defaultValue) {
    if (!defaultValue.value.static) {
      blockers.push(blocker(node, 'defaultValue', 'Dynamic defaults require a property-binding adapter'));
    } else if (defaultValue.value.json === null) {
      // A null default is the native module's closed initial state.
      defaultValue.value = staticValue(mode === 'multiple' ? '[]' : '');
    } else {
      const sourceDefault = defaultValue.value.json;
      const normalized = normalizedValue(mode, sourceDefault);
      if (normalized === undefined) blockers.push(blocker(node, 'defaultValue', 'Expected a string, string array, or null default value'));
      else defaultValue.value = staticValue(typeof normalized === 'string' || typeof sourceDefault === 'string' ? String(normalized) : JSON.stringify(normalized));
    }
  }

  // `multiple` is a source API alias; the target uses the explicit `type` attr.
  let outputAttributes = attributes.filter(attribute => attribute.name !== 'multiple');
  if (aliasType && !explicitType && !typeAttribute && multipleAttribute?.value.static) {
    const normalizedType = { ...multipleAttribute, name: 'type', value: { static: true, json: aliasType } as RetainedStaticValue };
    const next = outputAttributes.findIndex(attribute => attribute.name === 'defaultValue');
    outputAttributes.splice(next < 0 ? outputAttributes.length : next, 0, normalizedType);
  }

  return {
    node: { ...node, attributes: outputAttributes } as T,
    blockers,
  };
}

/** Retained family membership is exported for consumers that need an exact tag check. */
export function isNativeAccordionTag(tag: string): boolean { return FAMILY.has(tag); }
