/**
 * THE BOOKING GOLDEN, END TO END on the server: the document in
 * lib/story/__tests__/fixtures/booking.jsx published through the real door,
 * its compiled record stored and reused, its queries run on the SQLite engine,
 * and its two mutations — book and cancel — run through the document's write
 * door as two people and a guest, under the dataset's data policy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mutateRoute } from '@/app/a/[id]/mutate/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { readCompiledDataflow, storedCompiledDataflow } from '@/lib/story/parsed-artifact-metadata';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { request, useAppHarness } from './harness';

useAppHarness();

const GOLDEN = readFileSync(new URL('../lib/story/__tests__/fixtures/booking.jsx', import.meta.url), 'utf8');
const SNAPSHOT = JSON.parse(readFileSync(new URL('../lib/story/__tests__/__snapshots__/booking.compiled.json', import.meta.url), 'utf8'));
const COLUMNS = [
  { name: 'id', type: 'string' }, { name: 'day', type: 'date' }, { name: 'slot', type: 'string' },
  { name: 'booked_by', type: 'user' }, { name: 'note', type: 'string' }, { name: 'created_at', type: 'timestamp' },
];
/** Everyone who may read the booking page may book, and cancel only their own booking. */
const POLICY = {
  version: 1, enforcement: 'enabled',
  tables: [{
    table: { schema: 'public', name: 'rows' },
    insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: { booked_by: { _eq: 'X-Hasura-User-Id' } } } }],
    delete_permissions: [{ role: 'viewer', permission: { filter: { booked_by: { _eq: 'X-Hasura-User-Id' } } } }],
  }],
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function person(email: string) {
  const token = await mintToken(email);
  const user = await createUser({ email });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, email };
}
type Person = Awaited<ReturnType<typeof person>>;

async function publish(token: string, body: Record<string, unknown>) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
}

async function booking(markup = GOLDEN, policyAfterPublish = false) {
  const owner = await person('booking-owner@example.com');
  const guest = await person('booking-friend@example.com');
  const ds = (await publish(owner.token, { dataset: [], columns: COLUMNS, access: 'readwrite' })).id;
  const policy = async () => expect(await setDatasetPolicy({ tokenId: owner.tokenId, userId: owner.userId }, ds, POLICY, 0)).toMatchObject({ revision: 1 });
  if (!policyAfterPublish) await policy();
  const doc = (await publish(owner.token, { markup: markup.replace('ref:BookRows1', `ref:${ds}`), visibility: 'unlisted' })).id;
  if (policyAfterPublish) await policy();
  return { owner, guest, ds, doc };
}

const query = async (doc: string, only: string[], reader?: Person) => {
  // The POST door, as the page calls it: the reader's session rides in, and `$_me.id` is theirs.
  const actor = reader ? { credential: 'session' as const, userId: reader.userId, email: reader.email } : undefined;
  const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { only, tz: 'UTC' }, ...(actor ? { actor } : {}) }), ctx(doc));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { tables: Record<string, { rows: Array<Record<string, unknown>>; columns: Array<{ name: string; type: string }> }>; errors: Record<string, string> };
};
const mutate = (doc: string, body: unknown, token?: string) =>
  mutateRoute(request(`/a/${doc}/mutate`, { method: 'POST', json: body, ...(token ? { token } : {}) }), ctx(doc));

describe('the booking document, on the server', () => {
  it('publishes and stores the reviewed compiled record, bound to the stored source and reused on read', async () => {
    const { ds, doc } = await booking();
    const row = (await getArtifactById(doc))!;
    const stored = storedCompiledDataflow(row.meta, row.source!);
    expect(stored).not.toBeNull();
    // The reviewed record, but for the dataset's real id (and the spans that id's length moved).
    const unspanned = <T extends object>(x: T) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'start' || k === 'end' ? undefined : v)));
    expect(unspanned({ ...stored!, imports: stored!.imports.map((i) => ({ ...i, ref: 'BookRows1' })) })).toEqual(unspanned(SNAPSHOT));
    expect(stored!.imports[0]!.ref).toBe(ds);
    // Every declaration's span points at its own text in the stored (stamped) source.
    for (const d of [...stored!.queries, ...stored!.mutations]) expect(row.source!.slice(d.start, d.end)).toMatch(new RegExp(`^<(Query|Mutation) name="${d.name}"`));
    // A read uses the stored record: a loader that would be needed to compile again is never called.
    const refuse = async () => { throw new Error('recompiled on read'); };
    expect(await readCompiledDataflow(row.meta, row.source!, refuse)).toEqual(stored);
  });

  it('answers its queries, books a slot as the owner, refuses a double booking, and cancels', async () => {
    const { owner, guest, ds, doc } = await booking();
    const { tables, errors } = await query(doc, ['slots', 'mine'], owner);
    expect(errors).toEqual({});
    expect(tables.slots!.rows).toHaveLength(18);
    expect(tables.slots!.columns.find((c) => c.name === 'booked_by')?.type).toBe('user');
    expect(tables.mine!.rows).toEqual([]);
    const open = tables.slots!.rows.find((r) => r.is_open === 1) ?? tables.slots!.rows[tables.slots!.rows.length - 1]!;
    const row = { id: open.id, day: open.day, slot: open.slot };

    const booked = await mutate(doc, { mutation: 'book', args: { note: 'Dentist' }, row }, owner.token);
    expect(booked.status, await booked.clone().text()).toBe(200);
    const [written] = await loadDatasetRows((await getArtifactById(ds))!);
    expect(written).toMatchObject({ id: row.id, day: row.day, slot: row.slot, booked_by: owner.userId, note: 'Dentist' });
    expect(String(written!.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const mine = await query(doc, ['mine', 'slots'], owner);
    expect(mine.tables.mine!.rows).toEqual([{ id: row.id, day: row.day, slot: row.slot, note: 'Dentist' }]);
    expect(mine.tables.slots!.rows.find((r) => r.id === row.id)).toMatchObject({ is_mine: 1, is_open: 0, booked_by: owner.userId });

    // The slot is taken: the statement inserts nothing, and expectedAffected={1} says so.
    const twice = await mutate(doc, { mutation: 'book', args: { note: 'again' }, row }, guest.token);
    expect(twice.status).toBe(409);
    expect(await twice.json()).toMatchObject({ error: 'row_changed' });

    // Someone else cannot cancel it: their delete matches nothing of theirs.
    const stranger = await mutate(doc, { mutation: 'cancel', args: {}, row: { id: row.id } }, guest.token);
    expect(stranger.status).toBe(409);
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toHaveLength(1);

    const cancelled = await mutate(doc, { mutation: 'cancel', args: {}, row: { id: row.id } }, owner.token);
    expect(cancelled.status, await cancelled.clone().text()).toBe(200);
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([]);
  });

  it('lets a second person book and cancel their own slot under the data policy', async () => {
    const { guest, ds, doc } = await booking();
    const { tables } = await query(doc, ['slots'], guest);
    const slot = tables.slots!.rows[tables.slots!.rows.length - 1]!;
    const row = { id: slot.id, day: slot.day, slot: slot.slot };
    const booked = await mutate(doc, { mutation: 'book', args: { note: null }, row }, guest.token);
    expect(booked.status, await booked.clone().text()).toBe(200);
    expect((await loadDatasetRows((await getArtifactById(ds))!))[0]).toMatchObject({ booked_by: guest.userId, note: '' });
    const cancelled = await mutate(doc, { mutation: 'cancel', args: {}, row: { id: row.id } }, guest.token);
    expect(cancelled.status, await cancelled.clone().text()).toBe(200);
  });

  it('sends a guest to sign in, before judging the row', async () => {
    const { doc } = await booking();
    const res = await mutate(doc, { mutation: 'book', args: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'policy_denied', code: 'sign_in_required' });
  });

  it('refuses the write door\'s malformed calls by name', async () => {
    const { owner, doc } = await booking();
    const row = { id: '2099-01-01_09:00', day: '2099-01-01', slot: '09:00' };
    expect(await (await mutate(doc, { mutation: 'book', args: { note: 'x', extra: 1 }, row }, owner.token)).json()).toMatchObject({ detail: expect.stringMatching(/takes no argument extra/) });
    expect(await (await mutate(doc, { mutation: 'book', args: {} }, owner.token)).json()).toMatchObject({ error: 'invalid_row', detail: expect.stringMatching(/reads \$_row\.id/) });
    expect(await (await mutate(doc, { mutation: 'book', args: {}, row: { ...row, day: 7 } }, owner.token)).json()).toMatchObject({ error: 'invalid_row', detail: expect.stringMatching(/types must match/) });
    expect(await (await mutate(doc, { mutation: 'book', values: {}, row }, owner.token)).json()).toMatchObject({ error: 'unknown_mutation_fields' });
  });

  it('refuses a write the data policy does not admit', async () => {
    const withUpdate = GOLDEN.replace('</Helmet>', '  <Mutation name="renote" expectedAffected={1}>{`update bookings.rows set note = $note where id = $_row.id`}</Mutation>\n</Helmet>')
      .replace('<Column col="note" title="Note" />', '<Column col="note" title="Note"><Button run="$renote">Save</Button></Column>');
    // Published before the policy existed (publish would have refused it): the click is judged by the policy now.
    const { guest, doc } = await booking(withUpdate, true);
    const res = await mutate(doc, { mutation: 'renote', args: { note: 'x' }, row: { id: 'any' } }, guest.token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'policy_denied', detail: expect.stringMatching(/^Dataset policy: /) });
  });
});
