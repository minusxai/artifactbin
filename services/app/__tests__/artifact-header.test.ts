import {nativeHtml} from './native-html-fixture';
import { expect, it } from 'vitest';
import { useAppHarness, request, mintAccountToken } from './harness';
import { POST as publish } from '@/app/api/artifacts/route';
import { ARTIFACT_HEADER_COLUMNS, getArtifactHeaderById } from '@/lib/artifacts/rows';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';

useAppHarness();

/** THE ARTIFACT HEADER — every column of the row but its content, so a decision read from it can never lack a column the row has. */
it('names every column of the artifacts table but the two that carry the content', async () => {
  const db = await getDb();
  const columns = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'artifacts'")).rows.map((row) => row.column_name);
  expect([...ARTIFACT_HEADER_COLUMNS].sort()).toEqual(columns.filter((name) => name !== 'document' && name !== 'source').sort());
});

it('reads the same row as the whole-row read, less its document and source, and not a trashed one', async () => {
  const token = await mintAccountToken('header');
  const created = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'unlisted', html: nativeHtml('<h1 id="t">Header</h1>') } }));
  const { id } = await created.json() as { id: string };
  const whole = await getArtifactById(id);
  const header = await getArtifactHeaderById(id);
  expect(header).not.toBeNull();
  expect(header).not.toHaveProperty('document');
  expect(header).not.toHaveProperty('source');
  const { document: _document, source: _source, ...rest } = whole!;
  expect(header).toEqual(rest);
  await (await getDb()).query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [id]);
  expect(await getArtifactHeaderById(id)).toBeNull();
  expect(await getArtifactById(id)).toBeNull();
});
