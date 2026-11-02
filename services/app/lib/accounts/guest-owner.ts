import { getDb } from '@/lib/platform';

/** A workspace keeps its original account pin across verified guest adoption.
 * This is only an identity comparison: artifact permissions still use the live owner. */
export async function matchesWorkspaceAccount(expected: string, current: string): Promise<boolean> {
  if (expected === current) return true;
  const result = await (await getDb()).query(
    "SELECT 1 FROM users WHERE id = $1 AND kind = 'guest' AND merged_into_user_id = $2", [expected, current]);
  return result.rows.length > 0;
}
