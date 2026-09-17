/** Durable, origin-bound approval. Browser-visible codes cannot redeem credentials. */
import { createHash, randomBytes } from 'node:crypto';
import type { Actor, Queryable } from '@artifactbin/contracts';

const PAIRING_TTL_SECONDS = 300;
export interface ArtifactPairingTarget { artifactId: string }
interface PairingPayload { origin: string; target?: ArtifactPairingTarget; approvedBy?: Actor }
type PairingResult = { status: 'pending' | 'invalid' | 'denied' } | { status: 'approved'; userId: string | null; target?: ArtifactPairingTarget; approvedBy?: Actor };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const KIND = 'device_pairing';

export function createDevicePairing(db: Queryable, schema = 'auth') {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid auth schema');
  const table = `${schema}.credentials`;
  return {
    async begin(origin: string, target?: ArtifactPairingTarget) {
      const deviceCode = randomBytes(32).toString('base64url');
      const userCode = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
      await db.query(`DELETE FROM ${table} WHERE kind = $1 AND expires_at <= now()`, [KIND]);
      await db.query(`INSERT INTO ${table} (kind, credential_hash, group_id, payload, expires_at)
        VALUES ($1, $2, $3, $4, now() + interval '5 minutes')`,
      [KIND, hash(deviceCode), userCode, JSON.stringify({ origin, ...(target ? { target } : {}) })]);
      return { deviceCode, userCode, expiresIn: PAIRING_TTL_SECONDS, interval: 5 };
    },
    async inspect(userCode: string, origin: string) {
      const result = await db.query<{payload: PairingPayload}>(`SELECT payload FROM ${table} WHERE kind = $1 AND group_id = $2
        AND payload->>'origin' = $3 AND subject_id IS NULL AND consumed_at IS NULL
        AND deleted_at IS NULL AND payload->>'denied' IS DISTINCT FROM 'true'
        AND payload->>'anon' IS DISTINCT FROM 'true' AND expires_at > now()`, [KIND, userCode, origin]);
      return result.rows[0] ? { userCode, ...(result.rows[0].payload.target ? { target: result.rows[0].payload.target } : {}) } : null;
    },
    async approve(userCode: string, origin: string, userId: string, approvedBy?: Actor): Promise<boolean> {
      if (!userId) return false;
      const result = await db.query(`UPDATE ${table} SET subject_id = $4, payload = payload || $5::jsonb WHERE kind = $1 AND group_id = $2
        AND payload->>'origin' = $3 AND subject_id IS NULL AND consumed_at IS NULL
        AND deleted_at IS NULL AND payload->>'denied' IS DISTINCT FROM 'true'
        AND payload->>'anon' IS DISTINCT FROM 'true' AND expires_at > now() RETURNING credential_hash`, [KIND, userCode, origin, userId, JSON.stringify(approvedBy ? { approvedBy } : {})]);
      return result.rows.length === 1;
    },
    /** Approve with no account: the CLI receives an anonymous, claimable token. */
    async approveAnonymously(userCode: string, origin: string, approvedBy?: Actor): Promise<boolean> {
      const result = await db.query(`UPDATE ${table} SET payload = payload || $4::jsonb
        WHERE kind = $1 AND group_id = $2 AND payload->>'origin' = $3 AND subject_id IS NULL
        AND consumed_at IS NULL AND deleted_at IS NULL AND payload->>'denied' IS DISTINCT FROM 'true'
        AND payload->>'anon' IS DISTINCT FROM 'true' AND expires_at > now() RETURNING credential_hash`, [KIND, userCode, origin, JSON.stringify({ anon: true, ...(approvedBy ? { approvedBy } : {}) })]);
      return result.rows.length === 1;
    },
    async deny(userCode: string, origin: string): Promise<boolean> {
      const result = await db.query(`UPDATE ${table} SET payload = payload || '{"denied":true}'::jsonb
        WHERE kind = $1 AND group_id = $2 AND payload->>'origin' = $3 AND subject_id IS NULL
        AND consumed_at IS NULL AND deleted_at IS NULL AND payload->>'anon' IS DISTINCT FROM 'true'
        AND expires_at > now() RETURNING credential_hash`, [KIND,userCode,origin]);
      return result.rows.length === 1;
    },
    async consume(deviceCode: string, origin: string): Promise<PairingResult> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode)) return { status: 'invalid' };
      const args = [KIND, hash(deviceCode), origin];
      // Approved is either a bound account (subject_id) or an anonymous
      // approval (anon flag, no subject); the returned userId is null for anon.
      const approved = await db.query<{ subject_id: string | null; payload: PairingPayload }>(`UPDATE ${table} SET consumed_at = now()
        WHERE kind = $1 AND credential_hash = $2 AND payload->>'origin' = $3
        AND (subject_id IS NOT NULL OR payload->>'anon' = 'true')
        AND consumed_at IS NULL AND deleted_at IS NULL AND payload->>'denied' IS DISTINCT FROM 'true' AND expires_at > now() RETURNING subject_id, payload`, args);
      if (approved.rows[0]) return { status: 'approved', userId: approved.rows[0].subject_id ?? null, ...(approved.rows[0].payload.target ? { target: approved.rows[0].payload.target } : {}), ...(approved.rows[0].payload.approvedBy ? { approvedBy: approved.rows[0].payload.approvedBy } : {}) };
      // LIVE, not "still unapproved": an approval that lands between the claim above and this read is
      // neither claimed nor unapproved, and answering `invalid` for it told the CLI its approval had
      // expired (server CI run 35205911571). The poll after this one claims it.
      const pending = await db.query(`SELECT 1 FROM ${table} WHERE kind = $1 AND credential_hash = $2
        AND payload->>'origin' = $3 AND consumed_at IS NULL
        AND deleted_at IS NULL AND payload->>'denied' IS DISTINCT FROM 'true' AND expires_at > now()`, args);
      if (pending.rows.length) return {status:'pending'};
      const denied = await db.query(`SELECT 1 FROM ${table} WHERE kind = $1 AND credential_hash = $2
        AND payload->>'origin' = $3 AND payload->>'denied' = 'true' AND expires_at > now()`, args);
      return {status:denied.rows.length?'denied':'invalid'};
    },
  };
}
export type DevicePairing = ReturnType<typeof createDevicePairing>;
