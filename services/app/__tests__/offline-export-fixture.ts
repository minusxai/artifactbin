/**
 * The offline-export republish suites' shared fixture (offline-export-republish*.test.ts): an exported page whose copy
 * carries its owner's rows, and the create, replace and refusal helpers. Each suite calls useAppHarness itself.
 */
import { expect } from 'vitest';
import { request } from './harness';
import { getDb } from '@/lib/platform';
import { GET as download } from '@/app/a/[id]/download/route';
import { POST as create } from '@/app/api/artifacts/route';
import { GET as head, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { fixture, params, publish, ROWS, type Person } from './page-sql-door-fixture';


export const SECRET = 'zebra-secret-7731';
export const GENERATED = /data-af\s*=\s*["']?(?:offline-data|offline-sql|portable)\b/;

/** A page whose table is computed with `sql`, over the fixture's datasets and one only signed-in readers may select. */
export async function exportedPage() {
  const f = await fixture();
  const secret = await publish(f.owner, { dataset: [{ code: SECRET }], title: 'Secret' });
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [secret.body.id, JSON.stringify({ version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }] }] })]);
  const page = await publish(f.owner, { html: `<!doctype html><html><head><title>Staff report</title>
<link rel="af-dataset" data-af-name="staff" href="ref:${f.staff}"><link rel="af-dataset" data-af-name="secret" href="ref:${secret.body.id}">
<script src="/af/core.js"></script></head><body><table id="staff"><tbody></tbody></table>
<script type="module">import {sql} from '@afbin/apollo';
const rows=await sql\`select name, salary from staff order by name\`;
document.querySelector('#staff tbody').innerHTML=rows.map(r=>'<tr><td>'+r.name+'</td></tr>').join('');</script></body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  const response = await download(request(`/a/${page.body.id}/download`, { token: f.owner.token }), params(page.body.id));
  expect(response.status).toBe(200);
  const html = await response.text();
  // The owner's copy carries the owner's rows, the secret included: what must never be stored again.
  expect(html).toContain('data-af="offline-data"');
  expect(html).toContain(SECRET);
  return { ...f, page: page.body.id, html };
}

export async function post(who: Person, body: Record<string, unknown>) {
  const response = await create(request('/api/artifacts', { method: 'POST', token: who.token, json: { visibility: 'public', ...body } }));
  return { status: response.status, body: await response.json() as { id: string; version: number; state: string; error?: string; details?: string[] } };
}
export async function put(who: Person, id: string, body: Record<string, unknown>) {
  const row = await (await head(request(`/api/artifacts/${id}`, { token: who.token }), params(id))).json() as { version: number; state: string };
  const response = await replace(request(`/api/artifacts/${id}`, { method: 'PUT', token: who.token, json: { expectedVersion: row.version, expectedState: row.state, ...body } }), params(id));
  return { status: response.status, body: await response.json() as { id: string; error?: string; details?: string[] } };
}
const count = async () => Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM artifacts')).rows[0]!.n);
/** A refusal that stores nothing. */
export async function refusedWith(code: string, write: () => Promise<{ status: number; body: { error?: string; details?: string[] } }>) {
  const before = await count();
  const { status, body } = await write();
  expect(status, JSON.stringify(body)).toBe(400);
  expect(body.error).toBe(code);
  expect(await count()).toBe(before);
  return body.details?.join(' ') ?? '';
}

