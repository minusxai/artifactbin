/** The app owns deployment setup. Identity reads its committed state when changing the group tree. */
import type {Queryable} from '@artifactbin/contracts/db';
import {plainIdentifier} from './views';

interface Deployment {
  deployment_mode: string;
  owner_user_id: string | null;
  default_group_id: string | null;
  setup_complete: boolean | null;
}

export async function companyGroupState(tx: Queryable, appSchema?: string) {
  // The in-process store uses the app connection's search path. A separate auth host names the app schema.
  const prefix = appSchema ? plainIdentifier(appSchema, 'app schema') + '.' : '';
  const state = (await tx.query<Deployment>(`SELECT i.deployment_mode,d.owner_user_id,d.default_group_id,d.setup_complete
    FROM ${prefix}identity_settings i LEFT JOIN ${prefix}deployment_state d ON d.id='company'
    WHERE i.id='installation'`)).rows[0];
  if (state?.deployment_mode === 'public') return null;
  if (state?.deployment_mode !== 'company') throw new Error('deployment settings unavailable');
  return state;
}

/** Null for public mode. Company sign-in requires a complete live path from the default to a root. */
export async function companySignInRoot(tx: Queryable, groups: string, appSchema?: string) {
  const state = await companyGroupState(tx, appSchema);
  if (!state) return null;
  const root = state.setup_complete && state.default_group_id
    ? (await tx.query<{id:string}>(`WITH RECURSIVE ancestors(id,parent_id) AS (
        SELECT id,parent_id FROM ${groups} WHERE id=$1 AND deleted_at IS NULL
        UNION SELECT g.id,g.parent_id FROM ${groups} g JOIN ancestors a ON g.id=a.parent_id WHERE g.deleted_at IS NULL
      ) SELECT id FROM ancestors WHERE parent_id IS NULL`, [state.default_group_id])).rows[0] : undefined;
  return {rootId:root?.id, ownerId:state.owner_user_id};
}
