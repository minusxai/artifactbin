/**
 * DEPLOYS COME BEFORE THE MIGRATION: every document without the data-syntax
 * marker is served in the current syntax (lib/migrate/sqlite/stored
 * inCurrentSyntax) at every door — rendered, queried and written through —
 * with its stored bytes untouched; and an edit converts it for real first
 * (lib/sqlite-syntax-migration convertArtifactNow), so an edit never mixes
 * syntaxes.
 */
import { artifactQuery } from '@/lib/artifact-document';
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as mutateRoute } from '@/app/a/[id]/mutate/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { applyEditFor, getArtifactById, type ArtifactRow, type EditOutcome } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { PREVIOUS_ENGINE } from '@/lib/story/data-syntax';
import { prepareClientDocumentReplacement, prepareClientDocumentUpdate } from '@/lib/story/document-update-client';
import type { DocumentGraph } from '@/lib/story/document-graph';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const harness = useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner() {
  const token = await mintToken('mxmx_test_unmigrated');
  const user = await createUser({ email: 'unmigrated-owner@example.com' });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, email: user.email, actor: { tokenId: token.id, userId: user.id } };
}
type Owner = Awaited<ReturnType<typeof owner>>;

async function publish(who: Owner, body: Record<string, unknown>) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: who.token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A document as the previous engine stored it: its source, no marker. */
async function legacy(who: Owner, id: string, source: string) {
  await artifactQuery(await harness.db(), `INSERT INTO artifacts (id,token_id,user_id,source,format,version,visibility) VALUES ($1,$2,$3,$4,'markup',1,'unlisted')`, [id, who.tokenId, who.userId, source]);
}

const query = async (doc: string, who: Owner) => {
  const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { tz: 'UTC' }, actor: { credential: 'session', userId: who.userId, email: who.email } }), ctx(doc));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { tables: Record<string, { rows: Array<Record<string, unknown>> }>; errors: Record<string, string> };
};

const OLD = (ds: string) => `<Helmet><Query name="tasks" source="ref:${ds}">{\`select id, n / 2 as half from public.rows order by id\`}</Query><Mutation name="bump" source="ref:${ds}">{\`update public.rows set n = n + 1 where id = $_row.id\`}</Mutation></Helmet><DataTable data="$tasks" />`;
const MANUAL = '<Helmet><Value name="step" type="number" default={0} /><Query name="steps">{`select $step as s`}</Query><Mutation name="next">{`update _signals set step = step + 1`}</Mutation></Helmet><DataTable data="$steps" /><Button run="$next">Next</Button>';

describe('an unmigrated document, served', () => {
  it('renders, queries and writes through the converted form while its stored bytes stay as they were', async () => {
    const who = await owner();
    const ds = await publish(who, { title: 'Team Tasks', dataset: [{ id: 1, n: 5 }, { id: 2, n: 8 }], access: 'readwrite' });
    await legacy(who, 'oldtsk', OLD(ds));

    const html = await (await serveArtifact(request('/a/oldtsk/raw', { token: who.token }), ctx('oldtsk'))).text();
    expect(html).toContain('team_tasks.rows');
    expect(html).not.toContain('public.rows');
    const page = JSON.stringify(await (await pageData(request('/api/page/artifact/oldtsk', { token: who.token }), ctx('oldtsk'))).json());
    expect(page).toContain('team_tasks.rows');
    expect(page).not.toContain('public.rows');

    const { tables, errors } = await query('oldtsk', who);
    expect(errors).toEqual({});
    expect(tables.tasks!.rows).toEqual([{ id: 1, half: 2.5 }, { id: 2, half: 4 }]);

    const bumped = await mutateRoute(request('/a/oldtsk/mutate', { method: 'POST', json: { mutation: 'bump', row: { id: 1 } }, token: who.token }), ctx('oldtsk'));
    expect(bumped.status, await bumped.clone().text()).toBe(200);
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{ id: 1, n: 6 }, { id: 2, n: 8 }]);

    const stored = (await getArtifactById('oldtsk'))!;
    expect(stored.source).toBe(OLD(ds));
    expect(stored.meta.dataSyntax).toBeUndefined();
    expect(stored.version).toBe(1);
  });

  it('answers every query of one the converter cannot carry over with the previous-engine message', async () => {
    const who = await owner();
    await legacy(who, 'oldman', MANUAL);
    const html = await (await serveArtifact(request('/a/oldman/raw', { token: who.token }), ctx('oldman'))).text();
    expect(html).toContain(PREVIOUS_ENGINE);
    expect(await query('oldman', who)).toEqual({ tables: {}, errors: { steps: PREVIOUS_ENGINE } });
  });
});

describe('an unmigrated document, edited', () => {
  const RATIO = '<Helmet><Query name="ratio">{`select 7 / 2 as h`}</Query></Helmet><main id="root"><p id="a">Alpha</p><DataTable data="$ratio" /></main>';

  /** Published, then stripped of its marker: as the previous engine left it, with a document graph to edit. */
  async function unmarked(who: Owner, markup: string) {
    const id = await publish(who, { markup });
    await (await harness.db()).query("UPDATE artifacts SET meta=meta-'dataSyntax' WHERE id=$1", [id]);
    return id;
  }
  const snapshot = async (row: ArtifactRow) => {
    const document = (await (await harness.db()).query<{ document: DocumentGraph }>('SELECT document FROM artifacts WHERE id=$1', [row.id])).rows[0]!.document;
    return { document, version: row.version, meta: row.meta };
  };
  const prose = async (id: string, text: string) => {
    const head = (await getArtifactById(id))!;
    return { baseEditId: head.edit_id, documentUpdate: prepareClientDocumentUpdate(await snapshot(head), { operations: [{ kind: 'setText', path: [1, 0, 0], value: text }] }) };
  };

  it('converts first, as its own version by no actor, and meets the edit with the new head', async () => {
    const who = await owner();
    const id = await unmarked(who, RATIO);
    const edit = await prose(id, 'Edited');
    const refused = await applyEditFor(who.actor, id, edit) as EditOutcome;
    expect(refused).toMatchObject({ applied: false, reason: 'doc_changed', head: { version: 2 } });
    const converted = (await getArtifactById(id))!;
    expect(converted.source).toContain('select 7 * 1.0 / 2 as h');
    expect(converted.source).toContain('Alpha');
    expect(converted).toMatchObject({ version: 2, actor_user_id: null, actor_token_id: null, meta: { dataSyntax: 2, dataSyntaxMigration: { from: 1, version: 2 } } });

    const again = await applyEditFor(who.actor, id, await prose(id, 'Edited')) as EditOutcome;
    expect(again).toMatchObject({ applied: true });
    const edited = (await getArtifactById(id))!;
    expect(edited.source).toContain('Edited');
    expect(edited.source).toContain('select 7 * 1.0 / 2 as h');
    expect(edited.meta.dataSyntax).toBe(2);
  });

  it('marks one with nothing to convert in place and lets the edit through', async () => {
    const who = await owner();
    const id = await unmarked(who, '<main id="root"><p id="a">Plain</p><p id="b">Two</p></main>');
    const head = (await getArtifactById(id))!;
    const edit = prepareClientDocumentUpdate(await snapshot(head), { operations: [{ kind: 'setText', path: [0, 0, 0], value: 'Edited' }] });
    expect(await applyEditFor(who.actor, id, { baseEditId: head.edit_id, documentUpdate: edit })).toMatchObject({ applied: true });
    expect((await getArtifactById(id))!).toMatchObject({ version: head.version + 1, meta: { dataSyntax: 2 } });
  });

  it('edits one that needs a person as it stands', async () => {
    const who = await owner();
    await legacy(who, 'oldman', MANUAL);
    const replacement = prepareClientDocumentReplacement('<p>Rewritten by hand</p>', 1);
    expect(await applyEditFor(who.actor, 'oldman', { baseEditId: (await getArtifactById('oldman'))!.edit_id, documentUpdate: replacement })).toMatchObject({ applied: true });
    expect((await getArtifactById('oldman'))!).toMatchObject({ version: 2, source: expect.stringContaining('Rewritten by hand</p>'), meta: { dataSyntax: 2 } });
    expect((await (await harness.db()).query('SELECT count(*)::int AS n FROM artifact_versions WHERE artifact_id=$1', ['oldman'])).rows).toEqual([{ n: 1 }]);
  });

  it('converts once under concurrent edits', async () => {
    const who = await owner();
    const id = await unmarked(who, RATIO);
    const [a, b] = [await prose(id, 'One'), await prose(id, 'Two')];
    const outcomes = await Promise.all([applyEditFor(who.actor, id, a), applyEditFor(who.actor, id, b)]);
    expect(outcomes).toEqual([expect.objectContaining({ applied: false }), expect.objectContaining({ applied: false })]);
    const head = (await getArtifactById(id))!;
    expect(head).toMatchObject({ version: 2, meta: { dataSyntax: 2 } });
    expect(head.source!.match(/\* 1\.0/g)).toHaveLength(1);
  });
});
