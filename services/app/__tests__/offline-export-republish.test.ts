/**
 * AN EXPORT PUBLISHED AGAIN IS ITS SOURCE, NEVER ITS ROWS: a downloaded copy carries its reader's rows
 * (`data-af="offline-data"`) and the engine that reads them (`data-af="offline-sql"`), and no server path stores
 * either. Create, replace and preflight reduce a verified export to the source it carries (lib/operations
 * authoredHtml) and refuse one that no longer verifies; canonicalizeHtmlPage (lib/html-page) refuses either block in
 * any source, hand-written or carried. The new page reads its datasets live, under its own readers.
 */
import { beforeEach, expect, it } from 'vitest';
import { request, setSession, useAppHarness } from './harness';
import { getDb } from '@/lib/platform';
import { getArtifactById } from '@/lib/artifacts';
import { portableScript } from '@/lib/html-runtime/portable';
import { portableRenderedDigest } from '@/lib/html-runtime/portable-source';
import { GET as download } from '@/app/a/[id]/download/route';
import { POST as create } from '@/app/api/artifacts/route';
import { GET as head, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { POST as preflight } from '@/app/api/artifacts/preflight/route';
import { fixture, params, publish, sql, ROWS, type Person } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

const SECRET = 'zebra-secret-7731';
const GENERATED = /data-af\s*=\s*["']?(?:offline-data|offline-sql|portable)\b/;

/** A page whose table is computed with `sql`, over the fixture's datasets and one only signed-in readers may select. */
async function exportedPage() {
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

async function post(who: Person, body: Record<string, unknown>) {
  const response = await create(request('/api/artifacts', { method: 'POST', token: who.token, json: { visibility: 'public', ...body } }));
  return { status: response.status, body: await response.json() as { id: string; version: number; state: string; error?: string; details?: string[] } };
}
async function put(who: Person, id: string, body: Record<string, unknown>) {
  const row = await (await head(request(`/api/artifacts/${id}`, { token: who.token }), params(id))).json() as { version: number; state: string };
  const response = await replace(request(`/api/artifacts/${id}`, { method: 'PUT', token: who.token, json: { expectedVersion: row.version, expectedState: row.state, ...body } }), params(id));
  return { status: response.status, body: await response.json() as { id: string; error?: string; details?: string[] } };
}
const count = async () => Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM artifacts')).rows[0]!.n);
/** A refusal that stores nothing. */
async function refusedWith(code: string, write: () => Promise<{ status: number; body: { error?: string; details?: string[] } }>) {
  const before = await count();
  const { status, body } = await write();
  expect(status, JSON.stringify(body)).toBe(400);
  expect(body.error).toBe(code);
  expect(await count()).toBe(before);
  return body.details?.join(' ') ?? '';
}

it('creating a page from an export stores the page\'s source, and the page reads its datasets live as its own readers may', async () => {
  const f = await exportedPage();
  const original = (await getArtifactById(f.page))!.source!;
  const made = await post(f.owner, { html: f.html });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const source = (await getArtifactById(made.body.id))!.source!;
  expect(source).not.toMatch(GENERATED);
  expect(source).not.toContain(SECRET);
  expect(source).toBe(original);
  // Live, not frozen: a row added after the export is read through the new page.
  expect((await sql(made.body.id, f.owner, "insert into staff (name, team) values ('cy', 'red')")).status).toBe(200);
  expect((await sql(made.body.id, f.owner, 'select name from staff order by name')).body.rows).toEqual([{ name: 'ada' }, { name: 'bo' }, { name: 'cy' }]);
  // Under the new page's readers: the viewer's role view, and an anonymous reader of the public page reads no secret.
  expect((await sql(made.body.id, f.viewer, 'select name from staff order by name')).body.rows).toEqual([{ name: 'ada' }, { name: 'cy' }]);
  const anonymous = await sql(made.body.id, null, 'select code from secret');
  expect(anonymous.body.rows).toBeUndefined();
  expect(JSON.stringify(anonymous.body)).not.toContain(SECRET);
});

it('replacing a page with an export, or checking one first, stores and answers the source only', async () => {
  const f = await exportedPage();
  const other = await post(f.owner, { html: '<!doctype html><html><head><title>Old</title></head><body>Old</body></html>' });
  const replaced = await put(f.owner, other.body.id, { html: f.html });
  expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
  const source = (await getArtifactById(other.body.id))!.source!;
  expect(source).not.toMatch(GENERATED);
  expect(source).not.toContain(SECRET);
  expect(source).toContain('<table id="staff"');
  const checked = await preflight(request('/api/artifacts/preflight', { method: 'POST', token: f.owner.token, json: { input: { html: f.html } } }));
  expect(checked.status, await checked.clone().text()).toBe(200);
});

it('refuses an export edited outside its envelope, or one whose envelope is unreadable, and stores nothing', async () => {
  const f = await exportedPage();
  const at = f.html.lastIndexOf('</body>');
  const edited = f.html.slice(0, at) + '<p>edited on disk</p>' + f.html.slice(at);
  expect(await refusedWith('portable_copy_unverified', () => post(f.owner, { html: edited }))).toMatch(/publish the original source.*export the page again/);
  expect(await refusedWith('portable_copy_unverified', () => put(f.owner, f.page, { html: edited }))).toMatch(/export the page again/);
  const unreadable = '<!doctype html><html><head><title>x</title><script type="application/json" data-af="portable">{not json</script></head><body>x</body></html>';
  await refusedWith('portable_copy_unverified', () => post(f.owner, { html: unreadable }));
  expect((await getArtifactById(f.page))!.source).not.toContain('edited on disk');
});

it('refuses either block written by hand into ordinary HTML, or carried inside an envelope, on create and replace', async () => {
  const f = await fixture();
  const page = (block: string) => `<!doctype html><html><head><title>Hand</title>${block}</head><body><p>Hand made</p></body></html>`;
  const data = page('<script type="application/json" data-af="offline-data">{"tables":[{"schema":"main","name":"staff","columns":[],"rows":[]}]}</script>');
  const engine = page('<template><script type="application/json" data-af="offline-sql">"export {}"</script></template>');
  for (const html of [data, engine]) {
    expect(await refusedWith('invalid_html', () => post(f.owner, { html }))).toMatch(/exported copy/);
    expect(await refusedWith('invalid_html', () => put(f.owner, f.page, { html }))).toMatch(/exported copy/);
  }
  // An envelope is no way around it: one that verifies (its digest names the file around it) carries a source that is
  // checked as any source is.
  const plain = page('');
  const carried = plain.replace('<head>', '<head>' + portableScript({ version: 1, source: data, renderedDigest: portableRenderedDigest(plain) }));
  expect(await refusedWith('invalid_html', () => post(f.owner, { html: carried }))).toMatch(/offline-data/);
  expect((await getArtifactById(f.page))!.source).not.toMatch(GENERATED);
});
