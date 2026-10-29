/** The rows and people these tests stand on, made through public interfaces only. */
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifact } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';

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
/** A stored dataset row with no rows of its own; `policy` is the v2 grant policy it carries (none: `access` only). */
export const dataset = (actor: Account, policy?: unknown, extra: Record<string, unknown> = {}) =>
  createArtifact(null, actor.userId, { format: 'dataset', source: null, meta: {}, title: 'Data', access: policy ? undefined : 'readwrite', ...extra }, policy ? { datasetPolicy: { policy, revision: 0 } } : {});
export const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await (await getDb()).query<T>(text, params)).rows;
export const head = async (id: string) => (await sql<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1', [id]))[0]!;
