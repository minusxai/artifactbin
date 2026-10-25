import test from 'node:test';
import assert from 'node:assert/strict';
import type { NativeJson, RetainedJsxNode, RetainedStaticValue } from '../analyze-contracts.ts';
import { NATIVE_IDENTITY_DECORATION_RULES, prepareNativeIdentityDecoration } from './identity-decoration.ts';

type Element = Extract<RetainedJsxNode, { type: 'element' }>;
const value = (json: NativeJson): RetainedStaticValue => ({ static: true, json });
const element = (tag: string, attributes: Array<[string, NativeJson]> = [], children: RetainedJsxNode[] = []): Element => ({
  type: 'element', tag, isComponent: true, graphKey: `source-${tag}`, start: 10, end: 40, selfClosing: false,
  attributes: attributes.map(([name, json], index) => ({ name, value: value(json), start: 12 + index, end: 13 + index })), children,
});
const attr = (node: RetainedJsxNode, name: string): NativeJson | undefined => node.type === 'element' ? node.attributes.find(a => a.name === name)?.value.static ? (node.attributes.find(a => a.name === name)!.value as {static:true;json:NativeJson}).json : undefined : undefined;
const names = (node: RetainedJsxNode): string[] => node.type === 'element' ? node.attributes.map(a => a.name) : [];

test('maps Icon to the pinned local Lucide module and Separator to its retained div recipe', () => {
  assert.deepEqual(NATIVE_IDENTITY_DECORATION_RULES.map(rule => [rule.tag, rule.htmlTag, rule.kind, rule.module, rule.register]), [
    ['Icon', 'af-icon', 'native', 'icon', 'registerIcon'],
    ['Separator', 'div', 'semantic', undefined, undefined],
  ]);
  const icon = NATIVE_IDENTITY_DECORATION_RULES[0]!;
  assert.deepEqual(icon.attributes, { name: 'string', size: 'string', 'stroke-width': 'string', theme: ['light', 'dark', 'auto'], label: 'string' });
  assert.deepEqual(icon.properties, []);
  const separator = NATIVE_IDENTITY_DECORATION_RULES[1]!;
  assert.deepEqual(separator.attributes, { orientation: ['horizontal', 'vertical'], decorative: 'boolean', 'data-orientation': 'string', 'aria-orientation': 'string', role: 'string', 'data-slot': 'string' });
});

test('keeps the target icon default at 16px and its default decorative accessible state', () => {
  const source = element('Icon', [['name', 'circle-check']]);
  const result = prepareNativeIdentityDecoration(source);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.node.type === 'element' ? result.node.tag : null, 'Icon');
  assert.equal(attr(result.node, 'size'), undefined); // AfIcon defaults to 16; source size-4 recipe displays at 16.
  assert.equal(attr(result.node, 'theme'), undefined); // AfIcon emits no data-af-theme without an explicit theme.
  assert.equal(attr(result.node, 'name'), 'circle-check');
  assert.equal(result.node.graphKey, source.graphKey);
});

test('preserves the source full-Lucide name resolver fallback contract and rejects invalid names', () => {
  const unknown = prepareNativeIdentityDecoration(element('Icon', [['name', 'not-a-real-glyph']]));
  assert.deepEqual(unknown.blockers, []); // Product iconMarkup uses the same visible CircleQuestionMark fallback.
  const missing = prepareNativeIdentityDecoration(element('Icon'));
  assert.ok(missing.blockers.some(b => b.attribute === 'name' && b.code === 'identity-icon-name-required'));
  const dynamic = element('Icon');
  if (dynamic.type === 'element') dynamic.attributes.push({ name: 'name', value: { static: false, exprType: 'expression', source: '$glyph' }, start: 20, end: 24 });
  assert.ok(prepareNativeIdentityDecoration(dynamic).blockers.some(b => b.attribute === 'name'));
});

test('normalizes equal authored SVG width and height to AfIcon size and strokeWidth to observed stroke-width', () => {
  const source = element('Icon', [['name', 'activity'], ['width', 28], ['height', 28], ['strokeWidth', 1.5], ['aria-label', 'Activity']]);
  const result = prepareNativeIdentityDecoration(source);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(names(result.node), ['name', 'size', 'stroke-width', 'aria-label']);
  assert.equal(attr(result.node, 'size'), '28');
  assert.equal(attr(result.node, 'stroke-width'), '1.5');
  assert.equal(attr(result.node, 'aria-label'), 'Activity');
});

test('retains source theme and accessible label while target theme/default contracts stay explicit', () => {
  const result = prepareNativeIdentityDecoration(element('Icon', [['name', 'sun'], ['theme', 'dark'], ['label', 'Sun'] ]));
  assert.deepEqual(result.blockers, []);
  assert.equal(attr(result.node, 'theme'), 'dark');
  assert.equal(attr(result.node, 'label'), 'Sun');
});

test('blocks glyph overrides and unsupported SVG accessibility props without dropping source attributes', () => {
  const source = element('Icon', [['name', 'check'], ['glyphs', { Check: { cls: 'lucide-check', inner: '<path d="m2 2"></path>' } }], ['catalogUrl', '/icons.js'], ['title', 'Done']]);
  const result = prepareNativeIdentityDecoration(source);
  assert.deepEqual(result.blockers.map(b => [b.code, b.attribute]), [
    ['identity-icon-source-glyphs-unsupported', 'glyphs'],
    ['identity-icon-source-catalog-unsupported', 'catalogUrl'],
    ['identity-icon-svg-attribute-unsupported', 'title'],
  ]);
  assert.deepEqual(names(result.node), ['name', 'glyphs', 'catalogUrl', 'title']);
  assert.equal(result.node.graphKey, source.graphKey);
});

test('blocks independent width/height, ambiguous size and duplicate source props', () => {
  const result = prepareNativeIdentityDecoration(element('Icon', [['name', 'circle'], ['width', 20], ['size', '28'], ['strokeWidth', 2], ['stroke-width', 3], ['height', 24]]));
  assert.deepEqual(result.blockers.map(b => [b.code, b.attribute]), [
    ['identity-icon-size-conflict', 'width'],
    ['identity-icon-size-conflict', 'height'],
    ['identity-icon-size-conflict', 'size'],
    ['identity-icon-attribute-conflict', 'stroke-width'],
  ]);
  assert.equal(result.node.type === 'element' ? result.node.attributes.filter(a => a.name === 'width').length : 0, 1);
});

test('normalizes Separator horizontal/decorative defaults to the retained DOM recipe and preserves authored attrs', () => {
  const child: RetainedJsxNode = { type: 'text', value: 'child', graphKey: 'child', start: 40, end: 45 };
  const source = element('Separator', [['id', 'rule'], ['className', 'shrink-0 bg-border custom']], [child]);
  const result = prepareNativeIdentityDecoration(source);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(names(result.node), ['data-orientation', 'role', 'data-slot', 'id', 'className']);
  assert.deepEqual([attr(result.node, 'data-orientation'), attr(result.node, 'role'), attr(result.node, 'data-slot')], ['horizontal', 'none', 'separator']);
  assert.equal(attr(result.node, 'aria-orientation'), undefined);
  assert.equal(attr(result.node, 'id'), 'rule');
  assert.equal(attr(result.node, 'className'), 'shrink-0 bg-border custom');
  assert.equal(result.node.graphKey, source.graphKey);
  assert.equal(result.node.start, source.start); assert.equal(result.node.end, source.end);
  assert.equal(result.node.type === 'element' ? result.node.children[0] : undefined, child);
});

test('adds the pinned Separator recipe class only when the source did not retain a class attribute', () => {
  const result = prepareNativeIdentityDecoration(element('Separator'));
  assert.equal(attr(result.node, 'className'), 'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px');
});

test('uses the exact vertical semantic role and lets explicit spread props override recipe defaults', () => {
  const result = prepareNativeIdentityDecoration(element('Separator', [
    ['orientation', 'vertical'], ['decorative', false], ['role', 'note'], ['data-slot', 'custom'], ['aria-orientation', 'horizontal'],
  ]));
  assert.deepEqual(result.blockers, []);
  assert.deepEqual([attr(result.node, 'data-orientation'), attr(result.node, 'role'), attr(result.node, 'aria-orientation'), attr(result.node, 'data-slot')], ['vertical', 'note', 'horizontal', 'custom']);
});

test('rejects dynamic or invalid Separator behavior and preserves the original source node', () => {
  const source = element('Separator');
  if (source.type === 'element') source.attributes.push({ name: 'orientation', value: { static: false, exprType: 'expression', source: '$axis' }, start: 20, end: 25 });
  const result = prepareNativeIdentityDecoration(source);
  assert.ok(result.blockers.some(b => b.attribute === 'orientation'));
  assert.equal(result.node, source);

  const invalid = prepareNativeIdentityDecoration(element('Separator', [['orientation', 'diagonal'], ['decorative', 'false']]));
  assert.deepEqual(invalid.blockers.map(b => b.attribute), ['orientation', 'decorative']);
});

test('does not change other source tags, text, graph identities, or child structure', () => {
  const source = element('div', [['id', 'same']], [{ type: 'text', value: 'kept', graphKey: 'text', start: 41, end: 45 }]);
  const result = prepareNativeIdentityDecoration(source);
  assert.deepEqual(result, { node: source, blockers: [] });
  assert.deepEqual(prepareNativeIdentityDecoration({ type: 'text', value: 'plain', graphKey: 'text', start: 1, end: 6 }), { node: { type: 'text', value: 'plain', graphKey: 'text', start: 1, end: 6 }, blockers: [] });
});
