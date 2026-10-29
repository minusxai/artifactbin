/**
 * THE ARTIFACTS TABLE'S SECOND DOOR (DEEP_MODULES['lib/artifacts'] in scripts/ci/module-graph.mjs), for callers outside
 * that still query the table themselves (workspace listings, trash and analytics, publish preparation and fork, custom
 * domains, document trust, annotations, the compiled-page backfill): the row codec and the statement helpers a write
 * spells in SQL. The row type, the scopes and the trash gate are the access rule's (@/lib/artifact-access).
 */
export { artifactQuery } from './document';

/**
 * A row's live-update NOTIFY, spelled in SQL for a statement that notifies the rows it wrote: the channel is
 * `artifactChannel` (@artifactbin/contracts), and __tests__/live-channels.test.ts holds the two to one answer.
 */
export const notifyArtifactSql = (id: string, payload: string): string => `pg_notify('artifact_' || lower(${id}), ${payload})`;

/** What every new head stamps: the next version, its fresh edit id, who made it and when (placeholders are the caller's). */
export const headBumpSql = (editId: string, user: string, token: string): string =>
  `version = version + 1, edit_id = ${editId}, actor_user_id = ${user}, actor_token_id = ${token}, updated_at = now()`;
