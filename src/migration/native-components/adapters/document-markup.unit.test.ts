import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAD_METADATA_TAGS, SVG_NAMESPACE, SVG_TAGS, prepareNativeDocumentMarkup } from './document-markup.ts';
import type { RetainedJsxNode } from '../analyze-contracts.ts';

const attr = (name: string, json: unknown) => ({ name, start: 0, end: 1, value: { static: true as const, json: json as never } });
const element = (tag: string, attributes: ReturnType<typeof attr>[] = [], children: RetainedJsxNode[] = []): Extract<RetainedJsxNode, { type: 'element' }> => ({
  type: 'element', tag, isComponent: false, selfClosing: children.length === 0, graphKey: `node-${tag}`, start: 0, end: 4, attributes, children,
});

test('SVG admission preserves namespace, source spelling, paths and presentation attributes', () => {
  const path = element('path', [attr('d', 'M0 0 L10 10 Z'), attr('fill', 'none'), attr('stroke', '#222'), attr('strokeWidth', 2)]);
  const root = element('svg', [attr('viewBox', '0 0 100 50'), attr('xmlns', SVG_NAMESPACE), attr('className', 'diagram')], [path]);
  const plan = prepareNativeDocumentMarkup(root, { inHead: false, svgNamespace: false });
  assert.equal(plan.namespace, SVG_NAMESPACE);
  assert.equal(plan.node, root);
  assert.equal(plan.blockers.length, 0);
  assert.equal(root.attributes[0]?.name, 'viewBox');
  assert.equal(root.attributes[0]?.value.static ? root.attributes[0]?.value.json : undefined, '0 0 100 50');
  const child = prepareNativeDocumentMarkup(path, { inHead: false, svgNamespace: true });
  assert.equal(child.blockers.length, 0);
  assert.equal(child.node, path);
  assert.ok(SVG_TAGS.has('linearGradient'));
});

test('SVG tag and attribute allowlists reject executable, case-mismatched and URL-bearing source', () => {
  const badTag = prepareNativeDocumentMarkup(element('foreignObject'), { inHead: false, svgNamespace: true });
  assert.equal(badTag.blockers[0]?.code, 'svg-tag-unsupported');
  const badCase = prepareNativeDocumentMarkup(element('path', [attr('viewbox', '0 0 4 4')]), { inHead: false, svgNamespace: true });
  assert.equal(badCase.blockers[0]?.code, 'svg-attribute-unsupported');
  const executable = prepareNativeDocumentMarkup(element('path', [attr('onload', 'run()')]), { inHead: false, svgNamespace: true });
  assert.equal(executable.blockers[0]?.code, 'svg-executable-attribute');
  const url = prepareNativeDocumentMarkup(element('path', [attr('fill', 'url(https://example.invalid/a.svg#paint)')]), { inHead: false, svgNamespace: true });
  assert.equal(url.blockers[0]?.code, 'svg-url-or-control-value-unsupported');
  const href = prepareNativeDocumentMarkup(element('path', [attr('href', '#shape')]), { inHead: false, svgNamespace: true });
  assert.equal(href.blockers[0]?.code, 'svg-attribute-unsupported');
});

test('Helmet metadata is preserved as head-only and blocked outside real head context', () => {
  assert.ok(HEAD_METADATA_TAGS.has('meta'));
  const meta = element('meta', [attr('name', 'description'), attr('content', 'A retained page')]);
  const inHead = prepareNativeDocumentMarkup(meta, { inHead: true, svgNamespace: false });
  assert.equal(inHead.headOnly, true);
  assert.equal(inHead.node, meta);
  assert.deepEqual(inHead.blockers, []);
  const inBody = prepareNativeDocumentMarkup(meta, { inHead: false, svgNamespace: false });
  assert.equal(inBody.headOnly, undefined);
  assert.equal(inBody.blockers[0]?.code, 'metadata-outside-helmet');
  const unsafe = prepareNativeDocumentMarkup(element('meta', [attr('httpEquiv', 'refresh'), attr('content', '0;url=https://example.invalid')]), { inHead: true, svgNamespace: false });
  assert.ok(unsafe.blockers.length > 0);
  assert.ok(unsafe.blockers.some(item => item.code === 'metadata-value-unsupported'));
});
