import { describe, expect, it } from 'vitest';
import { catalogMetadata, migrateMarkupSource } from '../migrate';

describe('dataset catalog migration planning', () => {
  it('wraps a stored dataset without copying bytes and is idempotent', () => {
    const meta = { objectKey: 'datasets/a.json', columns: [{ name: 'id', type: 'number' as const }], rowCount: 2, note: 'keep' };
    const next = catalogMetadata(meta);
    expect(next).toEqual({ ...meta, catalog: { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
      tables: [{ schema: 'public', name: 'rows', columns: meta.columns, objectKey: meta.objectKey }] } });
    expect(catalogMetadata(next)).toBe(next);
  });

  it('rewrites declaration table tokens only, preserving comments, strings, row params and all other source bytes', () => {
    const source = '<Helmet>\n<Query name="q">{`select ref_abc123.id, \'ref_abc123\' s from ref_abc123 -- ref_abc123\nwhere note <> \'x\'`}</Query>\n<Mutation name="m">{`update ref_abc123 set n=$_value where id=$_row.id /* ref_abc123 */`}</Mutation>\n</Helmet><p id="same"> exact </p>';
    const out = migrateMarkupSource(source);
    expect(out.diagnostics).toEqual([]);
    expect(out.source).toContain('<Query name="q" source="abc123">{`select rows.id, \'ref_abc123\' s from public.rows -- ref_abc123');
    expect(out.source).toContain('<Mutation name="m" source="abc123">{`update public.rows set n=$_value where id=$_row.id /* ref_abc123 */`}');
    expect(out.source.endsWith('</Helmet><p id="same"> exact </p>')).toBe(true);
    expect(migrateMarkupSource(out.source).source).toBe(out.source);
  });

  it('federates a multi-source join through deterministic upstream queries and preserves aliases', () => {
    const source = '<Helmet><Query name="joined">{`select a.id,b.v from ref_abc123 a join ref_def456 b on ref_abc123.id=ref_def456.id`}</Query></Helmet><DataTable data="$joined" />';
    const out = migrateMarkupSource(source).source;
    expect(out).toContain('<Query name="source_abc123" source="abc123">{`select * from public.rows`}</Query>');
    expect(out).toContain('<Query name="source_def456" source="def456">{`select * from public.rows`}</Query>');
    expect(out).toContain('from source_abc123 a join source_def456 b on source_abc123.id=source_def456.id');
    expect(out.endsWith('<DataTable data="$joined" />')).toBe(true);
  });

  it('leaves queries without legacy refs and already canonical declarations byte-identical', () => {
    for (const source of ['<Helmet><Query name="q">{`select 1`}</Query></Helmet>', '<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet>']) {
      expect(migrateMarkupSource(source)).toMatchObject({ source, changed: false, diagnostics: [] });
    }
  });
});
