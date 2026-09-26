import { describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { renderDoc } from '../skills';
import { validateMarkupStructure } from '../story/local-validation';

const doc = (name: string) => renderDoc(`artifactbin/references/${name}.md`, 'https://example.test');
const blocks = (text: string, language: string) => [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map(match => match[1]);

describe('feedback authoring examples', () => {
  it.each([
    ['markup-select', '## Standalone multi-select'],
    ['markup-actions', '## Row action menus'],
    ['markup-data-authoring', '## Inline theme-token example'],
  ])('%s has a complete, valid %s example', (name, heading) => {
    const text = doc(name);
    expect(text).toContain(heading);
    const example = blocks(text.slice(text.indexOf(heading)), 'jsx')[0];
    expect(example).toContain('<Helmet>');
    expect(validateMarkupStructure(example).errors).toEqual([]);
  });

  it('the documented portable SQL examples run as both local and catalog reads', async () => {
    const examples = blocks(doc('markup-sql'), 'sql');
    expect(examples.length).toBeGreaterThan(0);
    const service = createSql({ maxRows: 20, timeoutMs: 2000 });
    for (const sql of examples) {
      const input = { tables: {}, queries: [{ name: 'q', sql }], params: {} };
      const local = (await service.run(input)).q;
      const catalog = (await service.run({ ...input, catalog: { defaultSchema: 'public', tables: [] } })).q;
      expect(local, sql).not.toHaveProperty('error');
      expect(catalog, sql).toEqual(local);
    }
  });
});
