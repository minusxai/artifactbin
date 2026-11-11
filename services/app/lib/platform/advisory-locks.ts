/**
 * AN APP INVARIANT'S LOCK ON SOMETHING THE APP DOES NOT OWN. A per-account quota or count (comment images, follows,
 * artifact memberships) needs its writers serialized on the account, but the account row is
 * the identity module's: the app never row-locks it (a split-role database gives the app SELECT only, and an
 * identity write must never wait on an app write). These are transaction-scoped advisory locks instead, keyed on
 * (`scope`, id), taken one id at a time in `COLLATE "C"` order so two writers never take them in opposite orders,
 * and released with the transaction. A hash collision only serializes two unrelated writers; it never admits one.
 */
import type {Queryable} from '@artifactbin/contracts';

export async function lockSubjects(tx: Queryable, scope: string, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [scope, id]);
}
