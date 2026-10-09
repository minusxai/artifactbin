import { expect, it } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { serializeJsx } from '@/lib/jsx';
import { splitHelmet } from '../document/helmet';
import { validateMarkupStructure } from '../document/local-validation';
import { collectRefUses, validateRefs } from '@/lib/dataflow/refs';
import { contextDocumentId, writeContextRef } from '../document/context';

const source = '<Helmet><Context src="ref:abc123" /></Helmet><p id="body">Dashboard</p>';

it('accepts same-server Doc links, IDs and refs without treating an external URL as a local artifact', () => {
  const origin = 'https://example.test';
  for (const input of ['abc123', ' ref:abc123 ', '/a/abc123', 'https://example.test/@owner/abc123-notes#edit']) {
    expect(contextDocumentId(input, origin), input).toBe('abc123');
  }
  for (const input of ['', 'bad', 'https://other.test/a/abc123', 'javascript:alert(1)', 'https://example.test/no-document']) {
    expect(contextDocumentId(input, origin), input).toBeNull();
  }
});

it('adds, replaces and removes context while preserving unrelated source and node identities', () => {
  const body = '<p id="kept">  Original content &amp; spacing </p>';
  for (const before of [body, '<Helmet />' + body, '<Helmet><title>Kept</title></Helmet>' + body]) {
    const added = writeContextRef(before, 'abc123');
    expect(added).toContain(body);
    expect(validateMarkupStructure(added).errors).toEqual([]);
    expect(splitHelmet(parseJsxOrThrow(added).nodes).content.context).toBe('abc123');
    const replaced = writeContextRef(added, 'def456');
    expect(replaced).not.toContain('ref:abc123');
    expect(replaced).toContain('ref:def456');
    const removed = writeContextRef(replaced, null);
    expect(removed).toContain(body);
    expect(removed).not.toContain('<Context');
    if (before.includes('<title>')) expect(removed).toContain('<title>Kept</title>');
  }
  expect(() => writeContextRef(body, 'https://other.test')).toThrow();
});

it('keeps a companion document in source and out of the rendered body', () => {
  expect(validateMarkupStructure(source).errors).toEqual([]);
  const parsed = parseJsxOrThrow(source);
  const split = splitHelmet(parsed.nodes);
  expect(split.content.context).toBe('abc123');
  expect(serializeJsx(split.body)).toContain('Dashboard');
  expect(serializeJsx(split.body)).not.toContain('Context');
  const roundTrip = parseJsxOrThrow(serializeJsx(parsed.nodes));
  expect(splitHelmet(roundTrip.nodes).content.context).toBe('abc123');
});

it.each([
  '<Helmet><Context /></Helmet>',
  '<Helmet><Context src="https://example.com/doc" /></Helmet>',
  '<Helmet><Context src="ref:abc123" extra="x" /></Helmet>',
  '<Helmet><Context src="ref:abc123">Notes</Context></Helmet>',
  '<Helmet><Context src="ref:abc123" /><Context src="ref:def456" /></Helmet>',
  '<Context src="ref:abc123" />',
])('rejects invalid companion declarations: %s', (markup) => {
  expect(validateMarkupStructure(markup).errors.length).toBeGreaterThan(0);
});

it('tracks context as a document reference and rejects missing, inaccessible and non-document targets', async () => {
  expect(collectRefUses(source)).toEqual([{ id: 'abc123', kind: 'document' }]);
  expect(await validateRefs(source, async id => ({ id, format: 'markup' })))
    .toEqual({ ok: true, refs: [{ id: 'abc123', kind: 'document' }] });
  for (const format of ['image', 'dataset', 'folder', 'file']) {
    expect((await validateRefs(source, async id => ({ id, format }))).ok).toBe(false);
  }
  expect((await validateRefs(source, async () => null)).ok).toBe(false);
});
