/**
 * A STORED SHAPE THE CURRENT CODE NO LONGER READS (lib/artifacts/servable) is refused by name at
 * every door — never converted on the fly, never a crash, never a stale render. And a stored
 * document that still carries the retired `data-annotation-anchor` attribute is no such shape:
 * the attribute is inert, and the version reads and renders.
 */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { GET as versionRoute } from '@/app/api/artifacts/[id]/versions/[version]/route';
import { GET as myVersionRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { POST as restoreRoute } from '@/app/api/artifacts/[id]/restore/route';
import {nativeHtml} from './native-html-fixture';
import {observedRequest} from './conditional-request';
import { artifactQuery } from '@/lib/artifacts/table';
import { servableDocument, UnservableDocument } from '@/lib/artifacts';
import { createDocumentGraph } from '@/lib/document/document-graph';

const harness = useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const MARKED = { dataSyntax: 2 };
const graph = (source: string) => createDocumentGraph(source, 1);

describe('servableDocument', () => {
  const row = { format: 'markup', version: 3, meta: MARKED, source: '<p id="a1b2">x</p>', document: graph('<p id="a1b2">x</p>') };

  it('passes a marked graph, and anything that is not markup', () => {
    expect(servableDocument(row)).toBe(row);
    expect(servableDocument({ format: 'dataset', version: 1, meta: {}, source: null, document: null }).format).toBe('dataset');
  });

  it('refuses an unmarked row as predating the data syntax', () => {
    expect(() => servableDocument({ ...row, meta: {} })).toThrow(UnservableDocument);
    expect(() => servableDocument({ ...row, meta: {} })).toThrow(/Version 3 .*predates the current data syntax.*restore it from the backup/);
  });

  it('refuses a row whose document is not a graph, or that decoded to no source', () => {
    for (const bad of [{ ...row, document: { schema: 1, kind: 'source', source: '<p>' } }, { ...row, source: null }, { ...row, document: null }]) {
      let thrown: unknown;
      try { servableDocument(bad); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(UnservableDocument);
      expect((thrown as UnservableDocument).status).toBe(410);
      expect((thrown as UnservableDocument).reason).toBe('unreadable');
    }
  });
});

/** Version 1 then version 2 (the head), published through the real doors. */
async function history() {
  const owner = await mintToken('mxmx_test_unservable');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: nativeHtml('<p>Version one</p>') } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const replaced = await replaceRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: {html:nativeHtml('<p>Version two</p>')} }), params({ id }));
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  const session = { credential: 'session' as const, userId: owner.userId!, email: owner.email!, emailVerified: true };
  return { owner, id, session };
}

async function expectRefused(response: Response, reason: RegExp) {
  expect(response.status, await response.clone().text()).toBe(410);
  const body = await response.json() as { error: string; message: string };
  expect(body.error).toBe('unservable_document');
  expect(body.message).toMatch(reason);
}

describe('an archived version the current code no longer reads', () => {
  it('native HTML does not require the retired data-syntax marker or a JSONB graph', async () => {
    const {owner,id,session}=await history();const db=await harness.db();
    await db.query("UPDATE artifact_versions SET meta=meta-'dataSyntax',document=NULL WHERE artifact_id=$1 AND version=1",[id]);
    for(const response of [await versionRoute(request(`/api/artifacts/${id}/versions/1`,{token:owner.token}),params({id,version:'1'})),await myVersionRoute(request(`/api/my/artifacts/${id}/versions/1`,{actor:session}),params({id,version:'1'})),await serveArtifact(request(`/a/${id}/raw?version=1`,{token:owner.token}),params({id})),await pageData(request(`/api/page/artifact/${id}?version=1`,{actor:session}),params({id}))])expect(response.status).toBe(200);
  });

  it('whose native source is missing: decoding never throws, and the doors refuse it', async () => {
    const { owner, id, session } = await history();
    const db = await harness.db();
    await db.query("UPDATE artifact_versions SET document=$2::jsonb, source=NULL WHERE artifact_id=$1 AND version=1", [id, JSON.stringify({ schema: 1, kind: 'source', source: '<p>broken' })]);
    const decoded = (await artifactQuery<{ source: string | null }>(db, 'SELECT * FROM artifact_versions WHERE artifact_id=$1 AND version=1', [id])).rows[0]!;
    expect(decoded.source).toBeNull();
    const unreadable = /no longer reads/;
    await expectRefused(await versionRoute(request(`/api/artifacts/${id}/versions/1`, { token: owner.token }), params({ id, version: '1' })), unreadable);
    await expectRefused(await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id })), unreadable);
    await expectRefused(await pageData(request(`/api/page/artifact/${id}?version=1`, { actor: session }), params({ id })), unreadable);
  });

  it('still carrying data-annotation-anchor is NOT refused: the attribute is inert, and the version reads and renders', async () => {
    const { owner, id } = await history();
    const legacy = '<main><p id="Ab12" data-annotation-anchor="Ab12">Old revenue line</p></main>';
    await (await harness.db()).query('UPDATE artifact_versions SET document=NULL, source=$2 WHERE artifact_id=$1 AND version=1', [id,nativeHtml(legacy)]);
    const read = await versionRoute(request(`/api/artifacts/${id}/versions/1`, { token: owner.token }), params({ id, version: '1' }));
    expect(read.status, await read.clone().text()).toBe(200);
    expect(((await read.json()) as { html: string }).html).toBe(nativeHtml(legacy));
    const rendered = await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }));
    expect(rendered.status).toBe(200);
    expect(await rendered.text()).toContain('Old revenue line');
  });
});

describe('restoring a trashed head the current code no longer reads', () => {
  it('is refused by name, and the row stays in the trash', async () => {
    const { owner, id } = await history();
    const db = await harness.db();
    await db.query("UPDATE artifacts SET source=NULL, deleted_at=now() WHERE id=$1", [id]);
    await expectRefused(await restoreRoute(request(`/api/artifacts/${id}/restore`, { method: 'POST', token: owner.token }), params({ id })), /no longer reads/);
    expect((await db.query<{ trashed: boolean }>('SELECT deleted_at IS NOT NULL AS trashed FROM artifacts WHERE id=$1', [id])).rows).toEqual([{ trashed: true }]);
  });
});
