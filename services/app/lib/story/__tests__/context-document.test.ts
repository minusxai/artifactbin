import { expect, it } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { serializeJsx } from '@/lib/jsx';
import { splitHelmet } from '../document/helmet';
import { validateMarkupStructure } from '../document/local-validation';
import { collectRefUses, validateRefs } from '../data/refs';

const source = '<Helmet><Context src="ref:abc123" /></Helmet><p id="body">Dashboard</p>';

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
