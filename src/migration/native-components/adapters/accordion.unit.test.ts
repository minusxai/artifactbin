import test from 'node:test';
import assert from 'node:assert/strict';
import type { NativeJson, RetainedAttribute, RetainedJsxNode, RetainedStaticValue } from '../analyze-contracts.ts';
import { NATIVE_ACCORDION_RULES, isNativeAccordionTag, prepareNativeAccordion } from './accordion.ts';

type RetainedElement = Extract<RetainedJsxNode, { type: 'element' }>;
const staticValue = (json: NativeJson): RetainedStaticValue => ({ static: true, json });
function element(tag = 'Accordion', attributes: Array<[string, NativeJson]> = [], children: RetainedJsxNode[] = []): RetainedElement {
  return {
    type: 'element', tag, isComponent: true, graphKey: `source-${tag}`, start: 0, end: 20, selfClosing: false,
    attributes: attributes.map(([name, json], index) => ({ name, value: staticValue(json), start: index, end: index + 1 })),
    children,
  };
}
const attribute = (node: RetainedElement, name: string): RetainedAttribute | undefined =>
  node.attributes.find(value => value.name === name);
const attributeJson = (node: RetainedElement, name: string): NativeJson | undefined => {
  const value = attribute(node, name)?.value;
  return value?.static ? value.json : undefined;
};

test('maps each source family tag to the reviewed accordion module and enforces compound parents', () => {
  assert.deepEqual(NATIVE_ACCORDION_RULES.map(rule => [rule.tag, rule.htmlTag, rule.module, rule.register]), [
    ['Accordion', 'af-accordion', 'accordion', 'registerAccordion'],
    ['AccordionItem', 'af-accordion-item', 'accordion', 'registerAccordion'],
    ['AccordionTrigger', 'af-accordion-trigger', 'accordion', 'registerAccordion'],
    ['AccordionContent', 'af-accordion-content', 'accordion', 'registerAccordion'],
  ]);
  assert.deepEqual(NATIVE_ACCORDION_RULES.find(rule => rule.tag === 'Accordion')?.attributes?.type, ['single']);
  assert.deepEqual(NATIVE_ACCORDION_RULES.find(rule => rule.tag === 'Accordion')?.properties, ['value']);
  assert.deepEqual(NATIVE_ACCORDION_RULES.find(rule => rule.tag === 'AccordionTrigger')?.parent, ['AccordionItem']);
  assert.equal(isNativeAccordionTag('AccordionContent'), true);
  assert.equal(isNativeAccordionTag('AccordionHeader'), false);
});

test('preserves the blocked source head shape, default single mode, IDs, and child identity', () => {
  const item = element('AccordionItem', [['value', 'numbers'], ['id', 'item-id']]);
  const source = element('Accordion', [['type', 'single'], ['collapsible', true], ['id', 'accordion-id']], [item]);
  const result = prepareNativeAccordion(source);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.node.tag, 'Accordion');
  assert.equal(result.node.graphKey, source.graphKey);
  assert.equal(result.node.children[0], item);
  assert.equal(attributeJson(result.node, 'type'), 'single');
  assert.equal(attributeJson(result.node, 'collapsible'), true);
  assert.equal(attributeJson(result.node, 'id'), 'accordion-id');
});

test('uses single as the exact omitted default and blocks an invented multiple alias', () => {
  const single = prepareNativeAccordion(element());
  assert.deepEqual(single.blockers, []);
  assert.equal(attribute(single.node, 'type'), undefined);

  const unsupportedAlias = prepareNativeAccordion(element('Accordion', [['multiple', true]]));
  assert.ok(unsupportedAlias.blockers.some(value => value.attribute === 'multiple'));
  assert.equal(attribute(unsupportedAlias.node, 'multiple'), undefined);
  assert.equal(attribute(unsupportedAlias.node, 'type'), undefined);
});

test('keeps string controlled/default values and forces source type multiple to single mode', () => {
  const source = element('Accordion', [['type', 'multiple'], ['value', 'one'], ['defaultValue', 'first']]);
  const prepared = prepareNativeAccordion(source);
  assert.deepEqual(prepared.blockers, []);
  assert.equal(attributeJson(prepared.node, 'type'), 'single');
  assert.equal(attributeJson(prepared.node, 'value'), 'one');
  assert.equal(attributeJson(prepared.node, 'defaultValue'), 'first');
  assert.equal(attributeJson(source, 'type'), 'multiple');

  const arrayValue = prepareNativeAccordion(element('Accordion', [['value', ['one', 'two']]]));
  assert.ok(arrayValue.blockers.some(value => value.attribute === 'value'));
  assert.deepEqual(attributeJson(arrayValue.node, 'value'), ['one', 'two']);
});

test('keeps collapsible behavior and a string default when source type is multiple', () => {
  const result = prepareNativeAccordion(element('Accordion', [
    ['type', 'multiple'], ['defaultValue', 'open-item'], ['collapsible', false],
  ]));
  assert.deepEqual(result.blockers, []);
  assert.equal(attributeJson(result.node, 'type'), 'single');
  assert.equal(result.node.type === 'element' ? result.node.attributes.filter(value => value.name === 'type').length : 0, 1);
  assert.equal(attribute(result.node, 'multiple'), undefined);
  assert.equal(attributeJson(result.node, 'defaultValue'), 'open-item');
  assert.equal(attributeJson(result.node, 'collapsible'), false);
});

test('reports unsupported source properties without changing source identity or children', () => {
  const child = element('AccordionItem', [['value', 'one']]);
  const invalid = element('Accordion', [['type', 'many'], ['multiple', true], ['collapsible', 'yes'], ['value', { invalid: true }]], [child]);
  const result = prepareNativeAccordion(invalid);
  assert.deepEqual(result.blockers.map(value => [value.code, value.attribute]), [
    ['accordion-prop-unsupported', 'type'],
    ['accordion-prop-unsupported', 'multiple'],
    ['accordion-prop-unsupported', 'collapsible'],
    ['accordion-prop-unsupported', 'value'],
  ]);
  assert.equal(result.node.graphKey, invalid.graphKey);
  assert.equal(result.node.children[0], child);
});

test('rejects non-string controlled/default values and malformed source props', () => {
  const invalidDefault = prepareNativeAccordion(element('Accordion', [['type', 'multiple'], ['defaultValue', ['one', 'two']]]));
  assert.ok(invalidDefault.blockers.some(value => value.attribute === 'defaultValue'));

  const invalidMultiple = prepareNativeAccordion(element('Accordion', [['multiple', 'true']]));
  assert.ok(invalidMultiple.blockers.some(value => value.attribute === 'multiple'));

  const dynamicDefault = element('Accordion');
  if (dynamicDefault.type === 'element') dynamicDefault.attributes.push({
    name: 'defaultValue', start: 1, end: 2, value: { static: false, exprType: 'expression', source: '$default' },
  });
  assert.ok(prepareNativeAccordion(dynamicDefault).blockers.some(value => value.attribute === 'defaultValue'));
});
