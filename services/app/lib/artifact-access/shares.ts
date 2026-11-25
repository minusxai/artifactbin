/** Named ACL rows. Access decisions may resolve an address during an ordinary read.
 * Grants and replacements take the artifact lock in their caller, which also advances its sharing revision.
 */
import type { Queryable } from '@artifactbin/contracts/db';
import type { ShareEntry } from '@artifactbin/contracts/sharing';

export const resolveSharesSql = (artifacts: string) => `UPDATE artifact_shares SET user_id = $2 WHERE artifact_id ${artifacts} AND user_id IS NULL AND email = (SELECT email FROM users WHERE id = $2)`;

/** Replace the named ACL, preserving the resolved account for each retained address. */
export async function replaceNamedShares(tx: Queryable, id: string, shares: readonly ShareEntry[]): Promise<void> {
  // Recreating retained rows would transfer access to a reused address.
  await tx.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND NOT (email=ANY($2::text[]))', [id, shares.map(entry => entry.email)]);
  for (const { email, role } of shares) {
    await tx.query('INSERT INTO artifact_shares (artifact_id,email,role) VALUES ($1,$2,$3) ON CONFLICT (artifact_id,email) DO UPDATE SET role=EXCLUDED.role', [id, email, role]);
  }
}

/** An invitation that includes access adds a viewer grant without replacing an existing share. */
export async function grantNamedViewer(tx: Queryable, id: string, userId: string, email: string): Promise<void> {
  await tx.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer') ON CONFLICT(artifact_id,email) DO NOTHING", [id, userId, email]);
}
