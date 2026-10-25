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
      type: ['single'], collapsible: 'boolean', disabled: 'boolean',
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

function blocker(node: RetainedJsxNode, attribute: string, detail: string): NativeLowerBlocker {
  return { code: 'accordion-prop-unsupported', sourceNode: node.graphKey, tag: 'Accordion', attribute, detail };
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
  if (typeAttribute) {
    if (!typeAttribute.value.static) blockers.push(blocker(node, 'type', 'Dynamic type cannot be retained by the Accordion source contract'));
    else if (typeAttribute.value.json !== 'single' && typeAttribute.value.json !== 'multiple') {
      blockers.push(blocker(node, 'type', 'Expected the source type value single or multiple'));
    } else {
      // The retained implementation accepts `multiple` but discards `type`; all items
      // still share one string selection. The target must therefore stay single.
      typeAttribute.value = staticValue('single');
    }
  }
  if (byName.has('multiple')) {
    blockers.push(blocker(node, 'multiple', 'multiple is not a source Accordion mode; source selection is always a single string'));
  }

  const collapsible = byName.get('collapsible');
  if (collapsible && (!collapsible.value.static || typeof collapsible.value.json !== 'boolean')) {
    blockers.push(blocker(node, 'collapsible', 'Expected a literal boolean collapsible value'));
  }

  const value = byName.get('value');
  if (value?.value.static && typeof value.value.json !== 'string') {
    blockers.push(blocker(node, 'value', 'The retained source contract controls one string value; arrays and non-strings are unsupported'));
  }

  const defaultValue = byName.get('defaultValue');
  if (defaultValue) {
    if (!defaultValue.value.static) {
      blockers.push(blocker(node, 'defaultValue', 'Dynamic defaults require a reviewed default-value binding adapter'));
    } else if (typeof defaultValue.value.json !== 'string') {
      blockers.push(blocker(node, 'defaultValue', 'The retained source contract initializes one string value; arrays and non-strings are unsupported'));
    }
  }

  // The source implementation splits `type` out of the DOM props but does not use
  // it to select items. Canonicalize valid authored types to the target's single mode.
  const outputAttributes = attributes.filter(attribute => attribute.name !== 'multiple');

  return {
    node: { ...node, attributes: outputAttributes } as T,
    blockers,
  };
}

/** Retained family membership is exported for consumers that need an exact tag check. */
export function isNativeAccordionTag(tag: string): boolean { return FAMILY.has(tag); }
