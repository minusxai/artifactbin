/**
 * Opening a region and accepting its updates (the HTTP side of lib/region-sessions). The database is the truth:
 * every decision is made inside one transaction holding the page FOR SHARE (edit access re-proved by the platform's
 * editor scope) and the region row FOR UPDATE, so two app processes serialize on the row. The documents kept here
 * are an advisory cache keyed by the row's identity and sequence, never authoritative.
 *
 * CLIENT IDS. Each open assigns a fresh Yjs client id (in no state and no log of the region, so never reused) and logs
 * the session's first update under it: an empty one, attributed to the opener. That row is the durable proof of who
 * holds the id, in every process; an update under an id no open issued to this actor is `foreign_client`.
 */
import { randomInt } from 'node:crypto';
import * as Y from 'yjs';
import { REGION_UPDATE_MAX_BYTES, type RegionFlushReply, type RegionOpenReply, type RegionRefusalBody, type RegionRefusalCode, type RegionUpdateReply } from '@artifactbin/contracts';
import { createRegionState, editableRegions, isRegionId, LiveRegionRefusal, validateRegionUpdate } from '@/lib/live-regions';
import { editablePage, liveRegionDoc, lockedRegionRows, logRegionUpdate, notifyRegions, saveLiveRegionsInTx, type RegionRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { ID_RE, type Db } from '@/lib/platform';

/** A route's answer: the contract's reply, the uniform not-found, or a typed refusal. */
export type RegionAnswer<T> = { status: 200; body: T } | { status: 404; body?: RegionRefusalBody } | { status: 409 | 413 | 422; body: RegionRefusalBody };

const NOT_FOUND = { status: 404 } as const;
const STATUS: Record<RegionRefusalCode, 404 | 409 | 413 | 422> = {
  region_not_found: 404, out_of_order: 409, region_snapshot_missing: 409, too_large: 413,
  unsupported_content: 422, foreign_client: 422, outside_region: 422,
};
const refuse = (error: RegionRefusalCode, stateVector?: Uint8Array): RegionAnswer<never> =>
  ({ status: STATUS[error], body: { error, ...(stateVector ? { stateVector: base64(stateVector) } : {}) } }) as RegionAnswer<never>;
function refusalOf(error: unknown): RegionAnswer<never> {
  if (!(error instanceof LiveRegionRefusal)) throw error;
  const code: RegionRefusalCode = error.code === 'missing_snapshot' || error.code === 'snapshot_mismatch' ? 'region_snapshot_missing' : error.code;
  return refuse(code, error.stateVector);
}

export const base64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());
/** The log is folded into the stored state at saves and at least this often. */
const FOLD_EVERY = 100;
const CACHED_DOCS = 64;

const actorKey = (actor: { userId: string | null; tokenId: string | null }) => `${actor.userId ?? ''}\u0000${actor.tokenId || ''}`;
/** A row's content identity: the same row (created_at) at the same sequence holds the same state. */
const stamp = (row: Pick<RegionRow, 'created_at' | 'last_seq'>, seq = row.last_seq) => `${row.created_at}#${seq}`;

export interface RegionStore {
  open(actor: AccessActor, artifactId: string, regionId: string): Promise<RegionAnswer<RegionOpenReply>>;
  update(actor: AccessActor, artifactId: string, regionId: string, request: { clientId: number; update: Uint8Array }): Promise<RegionAnswer<RegionUpdateReply>>;
  flush(actor: AccessActor, artifactId: string, options?: { idleBefore?: string }): Promise<RegionAnswer<RegionFlushReply>>;
}

export function regionStore(db: () => Promise<Db>, now: () => number): RegionStore {
  /** Advisory: the last documents this process built, by region, with the stamp they hold. Least recent dropped first. */
  const docs = new Map<string, { stamp: string; doc: Y.Doc }>();
  const take = (key: string, at: string): Y.Doc | undefined => {
    const hit = docs.get(key);
    docs.delete(key);
    return hit?.stamp === at ? hit.doc : undefined;
  };
  const keep = (key: string, at: string, doc: Y.Doc) => {
    docs.delete(key);
    docs.set(key, { stamp: at, doc });
    while (docs.size > CACHED_DOCS) docs.delete(docs.keys().next().value!);
  };
  /** Advisory: which actor holds a client id (rows are never rewritten, so a binding never changes). */
  const holders = new Map<string, string>();

  async function documentOf(tx: Parameters<Parameters<Db['transaction']>[0]>[0], artifactId: string, row: RegionRow): Promise<Y.Doc> {
    return take(`${artifactId}/${row.region_id}`, stamp(row)) ?? liveRegionDoc(tx, artifactId, row);
  }

  async function transact<T>(work: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<{ answer: RegionAnswer<T>; after?: () => void }>): Promise<RegionAnswer<T>> {
    let result: { answer: RegionAnswer<T>; after?: () => void };
    try { result = await (await db()).transaction(work); } catch (error) { return refusalOf(error); }
    result.after?.();
    return result.answer;
  }

  return {
    async open(actor, artifactId, regionId) {
      if (!ID_RE.test(artifactId) || !isRegionId(regionId)) return NOT_FOUND;
      return transact<RegionOpenReply>(async (tx) => {
        const page = await editablePage(tx, actor, artifactId, { lock: true, source: true });
        if (!page || page.format !== 'html') return { answer: NOT_FOUND };
        let [row] = await lockedRegionRows(tx, artifactId, regionId);
        if (!row) {
          const region = editableRegions(page.source ?? '').find((candidate) => candidate.id === regionId);
          if (!region) return { answer: refuse('region_not_found') };
          const initial = createRegionState(region.kind, region.inner);
          const created = await tx.query(
            'INSERT INTO region_states (artifact_id, region_id, kind, state, saved_version) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING region_id',
            [artifactId, regionId, region.kind, Buffer.from(initial.state), page.version],
          );
          if (created.rows.length) {
            await tx.query('INSERT INTO region_snapshots (artifact_id, region_id, version, snapshot) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [artifactId, regionId, page.version, Buffer.from(initial.snapshot)]);
          }
          [row] = await lockedRegionRows(tx, artifactId, regionId);
        }
        const doc = await documentOf(tx, artifactId, row!);
        const used = Y.decodeStateVector(Y.encodeStateVector(doc));
        let clientId: number;
        do clientId = randomInt(1, 2 ** 32 - 1);
        while (used.has(clientId) || (await tx.query('SELECT 1 FROM region_updates WHERE artifact_id = $1 AND region_id = $2 AND client_id = $3 LIMIT 1', [artifactId, regionId, clientId])).rows.length);
        const seq = row!.last_seq + 1;
        await logRegionUpdate(tx, artifactId, regionId, seq, clientId, EMPTY_UPDATE, actor);
        await tx.query('UPDATE region_states SET last_seq = $3 WHERE artifact_id = $1 AND region_id = $2', [artifactId, regionId, seq]);
        const opened: RegionOpenReply = { regionId, kind: row!.kind, clientId, seq, state: base64(Y.encodeStateAsUpdate(doc)), savedVersion: row!.saved_version };
        return {
          answer: { status: 200, body: opened },
          after: () => { keep(`${artifactId}/${regionId}`, stamp(row!, seq), doc); holders.set(`${artifactId}/${regionId}/${row!.created_at}/${clientId}`, actorKey(actor)); },
        };
      });
    },

    async update(actor, artifactId, regionId, request) {
      if (!ID_RE.test(artifactId) || !isRegionId(regionId)) return NOT_FOUND;
      if (request.update.byteLength > REGION_UPDATE_MAX_BYTES) return refuse('too_large');
      return transact<RegionUpdateReply>(async (tx) => {
        const page = await editablePage(tx, actor, artifactId, { lock: true });
        if (!page || page.format !== 'html') return { answer: NOT_FOUND };
        const [row] = await lockedRegionRows(tx, artifactId, regionId);
        if (!row) return { answer: refuse('region_not_found') };
        const holderKey = `${artifactId}/${regionId}/${row.created_at}/${request.clientId}`;
        let holder = holders.get(holderKey);
        if (holder === undefined) {
          const first = (await tx.query<{ actor_user_id: string | null; actor_token_id: string | null }>(
            'SELECT actor_user_id, actor_token_id FROM region_updates WHERE artifact_id = $1 AND region_id = $2 AND client_id = $3 ORDER BY seq LIMIT 1',
            [artifactId, regionId, request.clientId],
          )).rows[0];
          if (first) holders.set(holderKey, holder = actorKey({ userId: first.actor_user_id, tokenId: first.actor_token_id }));
        }
        if (holder !== actorKey(actor)) return { answer: refuse('foreign_client') };
        const key = `${artifactId}/${regionId}`;
        const doc = await documentOf(tx, artifactId, row);
        const check = validateRegionUpdate(row.kind, doc, request.update, request.clientId);
        if (check.duplicate) return { answer: { status: 200, body: { seq: row.last_seq, duplicate: true } }, after: () => keep(key, stamp(row), doc) };
        const seq = row.last_seq + 1;
        const at = new Date(now()).toISOString();
        await logRegionUpdate(tx, artifactId, regionId, seq, request.clientId, request.update, actor);
        const fold = seq - row.state_seq >= FOLD_EVERY;
        await tx.query(
          `UPDATE region_states SET last_seq = $3, last_update_at = $4, dirty_since = COALESCE(dirty_since, $4)${fold ? ', state = $5, state_seq = $3' : ''}
           WHERE artifact_id = $1 AND region_id = $2`,
          [artifactId, regionId, seq, at, ...(fold ? [Buffer.from(Y.encodeStateAsUpdate(doc))] : [])],
        );
        await notifyRegions(tx, artifactId, `${regionId}:${seq}`);
        return { answer: { status: 200, body: { seq } }, after: () => keep(key, stamp(row, seq), doc) };
      });
    },

    async flush(actor, artifactId, options = {}) {
      if (!ID_RE.test(artifactId)) return NOT_FOUND;
      return transact<RegionFlushReply>(async (tx) => {
        const saved = await saveLiveRegionsInTx(tx, actor, artifactId, options);
        return { answer: saved ? { status: 200, body: { version: saved.version } } : NOT_FOUND };
      });
    },
  };
}

