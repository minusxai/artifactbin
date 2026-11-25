/** The rows and people these tests stand on, made through public interfaces only. */
import { expect } from 'vitest';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { createUser } from '@/lib/accounts/testing';
import { getDb } from '@/lib/platform';
import { createArtifact } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { request } from '@/__tests__/harness';
import { requestOrSessionActor } from '@/lib/authentication';

export type Account = AccessActor & { userId: string };
export async function account(email: string): Promise<Account> {
  const user = await createUser({ email });
  return { ...identityForUser(user.id, null), email: user.email } as Account;
}
/** A guest or a test user: a person without an address an invitation could name. */
export async function personOfKind(kind: 'guest' | 'testuser'): Promise<Account> {
  const id = `usr_${kind}_${Math.random().toString(36).slice(2, 10)}`;
  await (await getDb()).query('INSERT INTO users (id,email,kind) VALUES ($1,NULL,$2)', [id, kind]);
  return identityForUser(id, null) as Account;
}
export const page = (title: string, extra: Record<string, unknown> = {}) => ({ format: 'html' as const, source: nativeHtml(`<p>${title}</p>`), meta: {}, title, ...extra });
export const mine = (actor: Account, title = 'Doc', extra: Record<string, unknown> = {}, atCreation: Parameters<typeof createArtifact>[3] = {}) =>
  createArtifact(null, actor.userId, page(title, extra), atCreation);
/** A stored dataset row with no rows of its own, `readwrite`; `policy` is the version 3 policy it carries (none: no stored policy). */
export const dataset = (actor: Account, policy?: unknown, extra: Record<string, unknown> = {}) =>
  createArtifact(null, actor.userId, { format: 'dataset', source: null, meta: {}, title: 'Data', access: 'readwrite', ...extra }, policy ? { datasetPolicy: { policy, revision: 0 } } : {});
/** Version 3: every rule role (viewer, signed_in, anonymous) reads all of `public.rows`; nobody below editor writes. */
export const readAllPolicy = () => ({ version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: ['viewer', 'signed_in', 'anonymous'].map((role) => ({ role, permission: { columns: '*', filter: {}, allow_aggregations: true } })) }] });
/** POST /api/artifacts as the bearer `token`: the route's own Response. */
export const postArtifact = (token: string, body: Record<string, unknown>) => createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
/** Publish through POST /api/artifacts as `token`, expecting 201: the new artifact's id. */
export const publishedId = async (token: string, body: Record<string, unknown>): Promise<string> => {
  const response = await postArtifact(token, body);
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
};
/** `publishedId`, resolving the request's actor first as a door does (`requestOrSessionActor`): the new id and that actor. */
export const publishedWithActor = async (token: string, body: Record<string, unknown>) => {
  const sent = request('/api/artifacts', { method: 'POST', token, json: body });
  const actor = await requestOrSessionActor(sent), response = await createArtifactRoute(sent);
  expect(response.status, await response.clone().text()).toBe(201);
  return { id: ((await response.json()) as { id: string }).id, actor };
};
export const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await (await getDb()).query<T>(text, params)).rows;
/** Store `policy` as the dataset's policy directly, past the policy door's validation and audit, bumping `policy_revision` as the door does. */
export const storePolicy = async (id: string, policy: unknown) => { await sql('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(policy)]); };
/** Move an artifact to the trash directly (no events, no folder wake-ups): `deleted_at = now()`. */
export const trashRow = async (id: string) => { await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [id]); };
/** Drop every share of an artifact directly. */
export const revokeShares = async (id: string) => { await sql('DELETE FROM artifact_shares WHERE artifact_id=$1', [id]); };
/** Set an artifact's visibility directly (no sharing revision bump, no notifications). */
export const setVisibility = async (id: string, visibility: 'private' | 'unlisted' | 'public') => { await sql('UPDATE artifacts SET visibility=$2 WHERE id=$1', [id, visibility]); };
export const head = async (id: string) => (await sql<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1', [id]))[0]!;
