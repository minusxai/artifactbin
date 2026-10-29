/**
 * THE MODULE'S LEDGERS through the interface: idempotent creation (operation keys, replays, recovery), reserved
 * identities, durable mutation receipts and their pinned context, and the deployment's mutation invocation seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { MUTATION_REPLY_TIMEOUT_MS } from '@artifactbin/contracts';
import {
  CreationReplay, completeMutationReceipt, createArtifact, creationOperation, durableMutation, lookupCreation, mutationInvocation, pinMutationContext,
  recoverCreationIds, reserveArtifactIds, reserveIds, setMutationInvocation, type MutationReceipt,
} from '@/lib/artifacts';
import { account, page, sql } from './fixtures';

const harness = useAppHarness();
const ORIGIN = 'https://app.test/api/artifacts';
const KEY = 'operation-key-0001';
afterEach(() => { vi.restoreAllMocks(); setMutationInvocation(undefined); });

describe('idempotent creation', () => {
  it('a key reserves one creation; a replay answers the stored reply, a changed payload is a mismatch', async () => {
    const owner = await account('owner@example.test');
    const reply = (row: { id: string }) => ({ status: 201, body: { id: row.id } });
    await expect(creationOperation(owner, ORIGIN, 'short', {}, reply)).rejects.toBeInstanceOf(CreationReplay);
    expect(await creationOperation(owner, ORIGIN, null, {}, reply)).toBeNull();
    const operation = (await creationOperation(owner, ORIGIN, KEY, { title: 'A' }, reply))!;
    const db = await harness.db();
    expect(await lookupCreation(db, operation)).toBeNull();
    const row = await createArtifact(null, owner.userId, page('A'), { operation });
    expect(await lookupCreation(db, operation)).toEqual({ status: 201, body: { id: row.id } });
    await expect(createArtifact(null, owner.userId, page('A'), { operation })).rejects.toMatchObject({ reply: { status: 201, body: { id: row.id } } });
    const changed = (await creationOperation(owner, ORIGIN, KEY, { title: 'B' }, reply))!;
    expect(await lookupCreation(db, changed)).toEqual({ status: 409, body: { error: 'idempotency_mismatch' } });
    // The same key from another origin is another operation.
    expect(await lookupCreation(db, (await creationOperation(owner, 'https://other.test', KEY, { title: 'A' }, reply))!)).toBeNull();
    expect(await recoverCreationIds(owner, ORIGIN, [KEY, 'unknown-key-000001'])).toEqual(new Map([[KEY, row.id]]));
    expect(await recoverCreationIds(owner, ORIGIN, [])).toEqual(new Map());
    await sql("UPDATE artifact_creation_operations SET response_until=now()-interval '1 second'");
    expect(await lookupCreation(db, operation)).toEqual({ status: 200, body: { id: row.id, recovered: true, response_expired: true } });
    await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [row.id]);
    expect(await lookupCreation(db, operation)).toEqual({ status: 410, body: { error: 'result_deleted', id: row.id } });
  });

  it('reserved identities: a batch is 100 stable ids in its owner\'s namespace; a count reservation is consumed once', async () => {
    const owner = await account('owner@example.test');
    const other = await account('other@example.test');
    await expect(reserveIds(owner, 'bad')).rejects.toMatchObject({ reply: { status: 400, body: { error: 'invalid_batch' } } });
    const batch = await reserveIds(owner, 'batch-000000000001');
    expect(batch).toHaveLength(100);
    expect(new Set(batch).size).toBe(100);
    expect(await reserveIds(owner, 'batch-000000000001')).toEqual(batch);
    await expect(reserveIds(owner, 'batch-000000000002', other.userId)).rejects.toMatchObject({ reply: { status: 409, body: { error: 'account_mismatch' } } });
    const row = await createArtifact(null, owner.userId, page('Reserved'), { reservedId: batch[0] });
    expect(row.id).toBe(batch[0]);
    await expect(createArtifact(null, other.userId, page('Theirs'), { reservedId: batch[1] })).rejects.toMatchObject({ reply: { status: 403, body: { error: 'reservation_not_owned' } } });
    const ids = await reserveArtifactIds(owner, 3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.some(id => batch.includes(id))).toBe(false);
  });
});

describe('durable mutation receipts', () => {
  it('runs the work once, replays its committed reply, and refuses a changed payload', async () => {
    const owner = await account('owner@example.test');
    let runs = 0;
    const work = async (receipt: MutationReceipt) => {
      runs++;
      expect(receipt).toMatchObject({ key: KEY, runId: expect.stringMatching(/^[a-f0-9]{64}$/), initiator: 'agent' });
      // A response committed with the content write is the answer, whatever the work returns afterwards.
      await completeMutationReceipt(await harness.db(), receipt, { status: 200, body: { committed: true } });
      return { status: 500, body: { late: true } };
    };
    expect(await durableMutation(owner, ORIGIN, 'bad', {}, work)).toEqual({ status: 400, body: { error: 'invalid_idempotency_key' } });
    expect(await durableMutation(owner, ORIGIN, KEY, { n: 1 }, work, { initiator: 'agent' } as never)).toEqual({ status: 200, body: { committed: true } });
    expect(await durableMutation(owner, ORIGIN, KEY, { n: 1 }, work)).toEqual({ status: 200, body: { committed: true } });
    expect(runs).toBe(1);
    expect(await durableMutation(owner, ORIGIN, KEY, { n: 2 }, work)).toEqual({ status: 409, body: { error: 'idempotency_mismatch' } });
  });

  it('a running operation is pending, then of unknown outcome once its reply window passed; its context pins once', async () => {
    const owner = await account('owner@example.test');
    const seen: unknown[] = [];
    await durableMutation(owner, ORIGIN, KEY, {}, async receipt => {
      await pinMutationContext(receipt, { compiled: 'v1' });
      expect(receipt.context).toEqual({ compiled: 'v1' });
      await expect(pinMutationContext(receipt, { compiled: 'v2' })).rejects.toThrow('mutation_context_already_claimed');
      seen.push((await durableMutation(owner, ORIGIN, KEY, {}, async () => ({ status: 200, body: {} }))).body.error);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + MUTATION_REPLY_TIMEOUT_MS + 1000);
      seen.push((await durableMutation(owner, ORIGIN, KEY, {}, async () => ({ status: 200, body: {} }))).body.error);
      return { status: 204, body: {} };
    });
    expect(seen).toEqual(['operation_pending', 'outcome_unknown']);
  });
});

describe('the mutation invocation seam', () => {
  it('defaults to the engine and is replaced by the deployment\'s factory', async () => {
    const engine = { mutate: vi.fn(async () => ({ ok: true }) as never) };
    const context = { dataset: {} as never, actor: {} as never, db: {} as never, recheckAccess: async () => {} };
    await mutationInvocation(context).run({ sql: 'x' } as never, engine);
    expect(engine.mutate).toHaveBeenCalledWith({ sql: 'x' });
    const factory = vi.fn(() => ({ run: async () => ({ ok: 'deployment' }) as never }));
    setMutationInvocation(factory);
    expect(await mutationInvocation(context).run({ sql: 'y' } as never, engine)).toEqual({ ok: 'deployment' });
    expect(factory).toHaveBeenCalledWith(context);
    expect(engine.mutate).toHaveBeenCalledTimes(1);
  });
});
