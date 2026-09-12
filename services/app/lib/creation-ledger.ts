import {createHash} from 'node:crypto';
import type {Queryable} from '@artifactbin/contracts';
import type {ArtifactRow,TokenActor} from './artifacts';

interface CreationReply {status: number; body: Record<string,unknown>}
export interface CreationOperation {
  scope: string;
  key: string;
  fingerprint: string;
  reply: (row: ArtifactRow) => CreationReply;
}
export class CreationReplay extends Error {
  constructor(readonly reply: CreationReply) {super('Creation operation already has a result');}
}
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered((value as Record<string,unknown>)[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');

export function creationOperation(actor: TokenActor, origin: string, key: string | null | undefined, payload: unknown, reply: CreationOperation['reply']): CreationOperation | null {
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new CreationReplay({status:400,body:{error:'invalid_idempotency_key'}});
  return {scope:hash([new URL(origin).origin,actor.userId ?? actor.tokenId]),key,fingerprint:hash(payload),reply};
}

export async function lookupCreation(db: Queryable, operation: CreationOperation): Promise<CreationReply | null> {
  const row = (await db.query<{
    request_hash: string; artifact_id: string | null; existing_id: string | null;
    deleted_at: unknown; response: Record<string,unknown> | null; response_status: number | null; fresh: boolean;
  }>(`SELECT o.*,a.id AS existing_id,a.deleted_at,(o.response_until>now()) AS fresh
    FROM artifact_creation_operations o LEFT JOIN artifacts a ON a.id=o.artifact_id
    WHERE o.scope=$1 AND o.operation_key=$2`,[operation.scope,operation.key])).rows[0];
  if (!row) return null;
  if (row.request_hash !== operation.fingerprint) return {status:409,body:{error:'idempotency_mismatch'}};
  if (!row.artifact_id) return {status:409,body:{error:'operation_pending'}};
  if (!row.existing_id || row.deleted_at) return {status:410,body:{error:'result_deleted',id:row.artifact_id}};
  if (row.fresh && row.response && row.response_status) return {status:row.response_status,body:row.response};
  return {status:200,body:{id:row.artifact_id,recovered:true,response_expired:true}};
}

/** Reservation and completion run on the same transaction as artifact creation. */
export async function reserveCreation(tx: Queryable, operation: CreationOperation): Promise<void> {
  const result = await tx.query(`INSERT INTO artifact_creation_operations(scope,operation_key,request_hash,response_until)
    VALUES ($1,$2,$3,now()+interval '1 day') ON CONFLICT DO NOTHING RETURNING operation_key`,[operation.scope,operation.key,operation.fingerprint]);
  if (!result.rows.length) {
    const reply = await lookupCreation(tx,operation);
    if (!reply) throw new Error('Creation reservation disappeared');
    throw new CreationReplay(reply);
  }
}

export async function completeCreation(tx: Queryable, operation: CreationOperation, row: ArtifactRow): Promise<void> {
  const reply = operation.reply(row);
  await tx.query(`UPDATE artifact_creation_operations SET artifact_id=$3,response=$4::jsonb,response_status=$5
    WHERE scope=$1 AND operation_key=$2`,[operation.scope,operation.key,row.id,JSON.stringify(reply.body),reply.status]);
}
