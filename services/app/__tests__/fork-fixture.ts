/**
 * The fork suites' shared fixture (fork*.test.ts). Each suite calls useAppHarness itself.
 */
import { expect } from 'vitest';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { POST as forkOpRoute } from '@/app/api/artifacts/[id]/fork/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';

export const BASE = 'http://localhost:3000';
export const sessionUser = { id: '', email: '' };

export const params = (id: string) => ({ params: Promise.resolve({ id }) });
export const jreq = (path: string, method: string, body?: unknown, token?: string, cookie?: string) =>
  new Request(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie, Origin: BASE } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
export const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', body, token));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; edit_id: string; version: number };
};
export const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
export const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };
export const fork = (id: string, cookie?: string) => forkRoute(jreq(`/api/my/artifacts/${id}/fork`, 'POST', undefined, undefined, cookie), params(id));
export const head = async (id: string) => (await getArtifactById(id))!;

export const PROSE = '<div><h1>Payroll</h1><p data-annotation-anchor="a1b2c3d4e">hello</p></div>';


export async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
  const owner = await createUser({ email: 'owner@x.com' });
  const ta = await mintToken('a', owner.id);
  const bob = await createUser({ email: 'bob@x.com' });
  const tb = await mintToken('b', bob.id);
  // `anon` is a legacy anonymous token (no account); `independent` is a token with an account of its own.
  const anon = await mintToken('anon',null);
  const independent = await mintToken('independent-account');
  const doc = await create(ta.token, { html:markup, visibility, title: 'The NBA payroll stack', description: 'for the dashboard', theme: 'industry', template: 'dashboard' });
  return { ta, tb, anon, independent, owner, bob, doc };
}
/** A folder of this token's own — placement on the wire is an id. */
export const createFolder = async (token: string, title: string) => (await create(token, { format: 'folder', title })).id;
/** The bearer door: POST /api/artifacts/:id/fork, the registry's `fork_artifact`. */
export const bearerFork = (id: string, token?: string, body: Record<string, unknown> = {}) =>
  forkOpRoute(jreq(`/api/artifacts/${id}/fork`, 'POST', body, token), params(id));
