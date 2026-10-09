import { describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { renderDoc } from '@/test/helpers/skill-docs';
import { validateMarkupStructure } from '../document/local-validation';

const doc = (name: string) => renderDoc(`artifactbin/references/${name}.md`, 'https://example.test');
const blocks = (text: string, language: string) => [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map(match => match[1]);

describe('feedback authoring examples', () => {
  it('teaches continuous Markdown prose on every page type while preserving HTML design freedom', () => {
    for (const general of [renderDoc('artifactbin/SKILL.md', 'https://example.test'), doc('markup')]) {
      expect(general).toContain('Use `<Markdown>` for long prose on any page type');
      expect(general).toContain('headings, paragraphs and lists together');
      expect(general).toContain('HTML for individually designed text');
    }
    const guide = doc('templates-doc');
    expect(guide).toContain('<Markdown>');
    expect(guide).toContain('not around each paragraph');
    const example = blocks(guide, 'jsx')[0];
    expect(example).toContain('<Markdown id="body">');
    expect(validateMarkupStructure(example).errors).toEqual([]);
    expect(doc('markup')).toContain('[Markdown](templates-doc.md)');
    expect(doc('templates-doc')).toContain('individually designed text');
  });
  it('teaches context as a linked Doc with independent permissions and editing', () => {
    const markup = [doc('markup'), doc('templates-doc')].join('\n');
    expect(markup).toContain('<Context src="ref:<documentId>" />');
    expect(markup).toContain('Open document');
    expect(markup).toContain('attaching it grants\nno access');
    expect(markup).toContain('afbin pull <documentId> --output context.jsx');
  });
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
    const examples = [...blocks(doc('markup-sql'), 'sql'), ...blocks(doc('markup-sql-functions'), 'sql')];
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
