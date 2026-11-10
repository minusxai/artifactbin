/**
 * AN EXPORTED PAGE'S `sql` OFFLINE: the download carries the rows its reader's `sql` could read through the page
 * (lib/dataset-access offlinePageSqlData) and the engine that answers them (lib/html-runtime offline-sql), so a table
 * the page computes with `sql` renders from the file with no network. The file's own embedded modules run here, linked
 * as its import map links them, with every fetch refused; the real-browser check is the offline-file gate.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { request, setSession, useAppHarness } from './harness';
import { getDb } from '@/lib/platform';
import { GET as download } from '@/app/a/[id]/download/route';
import { fixture, params, publish, ROWS, type Person } from './page-sql-door-fixture';
import { OFFLINE_SQL_NO_DATA, OFFLINE_SQL_NO_DATA_EVENT } from '@/lib/html-runtime/portable-chrome-contract';

/** The export's data cap, lowered by one test to stand for rows past 16 MiB: the real read, a smaller limit. */
const cap = vi.hoisted(() => ({ maxBytes: undefined as number | undefined }));
vi.mock('@/lib/dataset-access', async (actual) => {
  const real = await actual<typeof import('@/lib/dataset-access')>();
  return { ...real, offlinePageSqlData: (...args: Parameters<typeof real.offlinePageSqlData>) => real.offlinePageSqlData(args[0], args[1], args[2], cap.maxBytes ?? args[3], args[4]) };
});

useAppHarness();
beforeEach(() => setSession(null));
afterEach(() => { vi.unstubAllGlobals(); cap.maxBytes = undefined; });

const SECRET = 'zebra-secret-7731';
const PAGE_SQL = 'select name, salary from staff order by name';

/** The fixture's page links plus a dataset only signed-in readers may select, and a table the page builds with `sql`. */
async function exportedPage() {
  const f = await fixture();
  const secret = await publish(f.owner, { dataset: [{ code: SECRET }], title: 'Secret' });
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [secret.body.id, JSON.stringify({ version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }] }] })]);
  const page = await publish(f.owner, { html: `<!doctype html><html><head><title>Staff report</title>
<link rel="af-dataset" data-af-name="staff" href="ref:${f.staff}"><link rel="af-dataset" data-af-name="notes" href="ref:${f.notes}"><link rel="af-dataset" data-af-name="secret" href="ref:${secret.body.id}">
<script src="/af/core.js"></script></head><body><table id="staff"><tbody></tbody></table>
<script type="module">import {sql} from '@afbin/apollo';
const rows=await sql\`${PAGE_SQL}\`;
document.querySelector('#staff tbody').innerHTML=rows.map(r=>'<tr><td>'+r.name+'</td><td>'+r.salary+'</td></tr>').join('');</script></body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { ...f, page: page.body.id };
}

async function exported(page: string, who: Person | null) {
  const response = await download(request(`/a/${page}/download`, who ? { token: who.token } : {}), params(page));
  expect(response.status).toBe(200);
  return response.text();
}

const block = (doc: Document, name: string) => doc.querySelector(`script[data-af="${name}"]`)?.textContent ?? null;
const dataUrl = (code: string) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');

/** The file's `@afbin/apollo`, `@afbin/state` and `@afbin/offline-sql`, linked as its core's import map links them, offline. */
async function openOffline(html: string) {
  const doc = new JSDOM(html).window.document;
  const config = JSON.parse(block(doc, 'runtime')!), data = block(doc, 'offline-data'), engine = block(doc, 'offline-sql');
  const refused = vi.fn(async () => { throw new TypeError('network refused'); });
  vi.stubGlobal('fetch', refused);
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === 'script[data-af="offline-data"]' && data !== null ? { textContent: data } : null) });
  vi.stubGlobal('location', { hash: '' }); vi.stubGlobal('navigator', {});
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {});
  const key = `__offlineSqlReader${Math.random().toString(36).slice(2)}`;
  vi.stubGlobal(key, { config, remote: { online: () => false, execute: () => Promise.reject(new Error('no app')) }, startFrameBridge() {}, onResolverChange: () => ({ unsubscribe() {} }), remoteReadOnly: true });
  const reader = dataUrl(`const r=globalThis.${key};export const {config,remote,startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload}=r;`);
  const bind = (code: string, name: string, url: string) => code.replace(new RegExp(`(["'])@afbin/${name}\\1`, 'g'), JSON.stringify(url));
  const state = dataUrl(bind(JSON.parse(block(doc, 'state-module')!), 'reader', reader));
  let apollo = bind(bind(JSON.parse(block(doc, 'apollo')!), 'reader', reader), 'state', state);
  // A fresh module per opened file, as each document gets its own (Node would share one identical data: module).
  if (engine !== null) apollo = bind(apollo, 'offline-sql', dataUrl(`${JSON.parse(engine)}\n//${key}`));
  const runtime = await import(/* @vite-ignore */ dataUrl(apollo));
  return { runtime, refused, data: data === null ? null : JSON.parse(data) as { tables: Array<{ schema: string; name: string; columns: Array<{ name: string }>; rows: Array<Record<string, unknown>> }> } };
}
const reject = (statement: PromiseLike<unknown>) => Promise.resolve(statement).then(() => null, (e: { code?: string }) => e.code);

it('answers the page\'s own sql table from the rows it carries, with every request refused', async () => {
  const f = await exportedPage();
  const { runtime, refused, data } = await openOffline(await exported(f.page, f.owner));
  expect(data!.tables.map((t) => `${t.schema}.${t.name}`).sort()).toEqual(['main.notes', 'main.secret', 'main.staff']);
  expect([...await runtime.sql([PAGE_SQL] as unknown as TemplateStringsArray)]).toEqual([{ name: 'ada', salary: 10 }, { name: 'bo', salary: 20 }]);
  // Bound values, aggregates and joins read as the door reads them.
  expect([...await runtime.sql`select count(*) as n from staff where salary > ${15}`]).toEqual([{ n: 1 }]);
  expect([...await runtime.sql`select n.note, count(s.name) as c from notes n, staff s group by n.note`]).toEqual([{ note: 'hello', c: 2 }]);
  // A copy reads; it never writes, and refuses what the door refuses.
  expect(await reject(runtime.sql`insert into staff (name) values (${'x'})`)).toBe('permission_denied');
  expect(await reject(runtime.sql`select * from sqlite_master`)).toBe('validation_failed');
  expect(refused).not.toHaveBeenCalled();
});

it('carries only what its reader may read: a hidden column or an unreadable table is neither in the file nor answered', async () => {
  const f = await exportedPage();
  const html = await exported(f.page, null);
  expect(html).not.toContain(SECRET);
  const { runtime, data } = await openOffline(html);
  // Anonymous through the unlisted page: staff's names only, notes whole, the signed-in-only dataset absent.
  expect(data!.tables.map((t) => t.name).sort()).toEqual(['notes', 'staff']);
  expect(data!.tables.find((t) => t.name === 'staff')!.columns.map((c) => c.name)).toEqual(['_id', 'name']);
  expect(data!.tables.find((t) => t.name === 'staff')!.rows.every((row) => Object.keys(row).sort().join() === '_id,name')).toBe(true);
  expect([...await runtime.sql`select name from staff order by name`]).toEqual([{ name: 'ada' }, { name: 'bo' }]);
  expect(await reject(runtime.sql`select salary from staff`)).toBe('validation_failed');
  expect(await reject(runtime.sql`select code from secret`)).toBe('validation_failed');
  // The viewer's role view: red rows only, without salary.
  const viewer = await openOffline(await exported(f.page, f.viewer));
  expect([...await viewer.runtime.sql`select name, team from staff`]).toEqual([{ name: 'ada', team: 'red' }]);
  expect(viewer.data!.tables.find((t) => t.name === 'staff')!.columns.map((c) => c.name)).not.toContain('salary');
});

it('a page that links no dataset carries no rows and no engine, and its sql says why', async () => {
  const f = await fixture();
  const page = await publish(f.owner, { html: '<!doctype html><html><head><title>Plain</title></head><body>Plain</body></html>' });
  const html = await exported(page.body.id, f.owner);
  const doc = new JSDOM(html).window.document;
  expect(block(doc, 'offline-data')).toBeNull();
  expect(block(doc, 'offline-sql')).toBeNull();
  const { runtime } = await openOffline(html);
  await expect(Promise.resolve(runtime.sql`select 1 as one`)).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('carries no data') });
});

it('a copy whose rows are over the cap carries none, and its sql and its local controls say so: never a silent empty table', async () => {
  const f = await exportedPage();
  cap.maxBytes = 8;
  const html = await exported(f.page, f.owner);
  const doc = new JSDOM(html).window.document;
  expect(block(doc, 'offline-data')).toBeNull();
  expect(block(doc, 'offline-sql')).toBeNull();
  const { runtime } = await openOffline(html);
  const dispatched = vi.fn();
  vi.stubGlobal('dispatchEvent', dispatched);
  await expect(Promise.resolve(runtime.sql([PAGE_SQL] as unknown as TemplateStringsArray))).rejects.toMatchObject({ code: 'unavailable', message: OFFLINE_SQL_NO_DATA });
  // The copy's local controls show the same sentence (lib/html-runtime portable-session).
  expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ type: OFFLINE_SQL_NO_DATA_EVENT }));
  expect(OFFLINE_SQL_NO_DATA).toMatch(/carries no data.*open the original page/);
});
