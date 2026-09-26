import { expect, it, vi } from 'vitest';
import { useAppHarness } from './harness';
import { dataflowForRow, datasetsForDocument, type ArtifactRow } from '@/lib/artifacts';
import { compileParsedArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';
import * as jsx from '@/lib/jsx';

useAppHarness();
it('executes persisted declarations without reparsing source, falling back for stale metadata', async () => {
  const source = '<Helmet><Query name="answer">{`select 42 as n`}</Query></Helmet><p>Hello</p>';
  const row = { source, meta: { parsedArtifact: compileParsedArtifactMetadata(source) } } as unknown as ArtifactRow;
  const parse = vi.spyOn(jsx, 'parseJsx');
  try {
    expect((await dataflowForRow(row))?.state.tables.answer.rows).toEqual([{ n: 42 }]);
    expect(parse).not.toHaveBeenCalled();
    const changed = { ...row, source: source.replace('42', '43') };
    expect((await dataflowForRow(changed))?.state.tables.answer.rows).toEqual([{ n: 43 }]);
    expect(parse).toHaveBeenCalledTimes(1);
  } finally { parse.mockRestore(); }
});

it('live dependency reads include every query and persistent mutation target without parsing again', () => {
  const source = '<Helmet><Import name="a_data" src="ref:ABC123" /><Query name="a">{`select * from a_data.rows`}</Query><Import name="b_data" src="ref:DEF456" /><Query name="b">{`select * from b_data.rows`}</Query><Import name="write_data" src="ref:GHI789" /><Mutation name="write">{`insert into write_data.rows values (1)`}</Mutation></Helmet><p>Live</p>';
  const row = { source, meta: { parsedArtifact: compileParsedArtifactMetadata(source) } };
  const parse = vi.spyOn(jsx, 'parseJsx');
  try {
    expect(datasetsForDocument(row)).toEqual(['ABC123', 'DEF456', 'GHI789']);
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});
