/**
 * AN EXPORTED PAGE'S `sql` OFFLINE: the download carries the rows its reader's `sql` could read through the page
 * (lib/dataset-access offlinePageSqlData) and the engine that answers them (lib/html-runtime offline-sql), so a table
 * the page computes with `sql` renders from the file with no network. The file's own embedded modules run here, linked
 * as its import map links them, with every fetch refused; the real-browser check is the offline-file gate.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { storePolicy } from '@/__tests__/artifact-fixtures';
import { JSDOM } from 'jsdom';
import * as esbuild from 'esbuild';
import { POST } from '@/app/api/artifacts/route';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { GET as download } from '@/app/a/[id]/download/route';
import { fixture, params, publish, ROWS, type Person } from './page-sql-door-fixture';
import { OFFLINE_SQL_NO_DATA, OFFLINE_SQL_NO_DATA_EVENT } from '@/lib/html-runtime/portable-chrome-contract';

/** Lower the SQL admission cap or supply admitted rows to exercise final HTML sizing. */
const cap = vi.hoisted(() => ({ maxBytes: undefined as number | undefined, rows: undefined as string | undefined }));
vi.mock('@/lib/dataset-access', async (actual) => {
  const real = await actual<typeof import('@/lib/dataset-access')>();
  return { ...real, offlinePageSqlData: (...args: Parameters<typeof real.offlinePageSqlData>) => cap.rows === undefined ? real.offlinePageSqlData(args[0], args[1], args[2], cap.maxBytes ?? args[3], args[4])
    : Promise.resolve({ tables: [{ schema: 'main', name: 'budget', columns: [{ name: 'text', type: 'string' }], rows: [{ text: cap.rows }] }] }) };
});

vi.mock('esbuild', async (actual) => {
  const real = await actual<typeof esbuild>();
  return { ...real, build: vi.fn(real.build) };
});

useAppHarness();
beforeEach(() => setSession(null));
afterEach(() => { vi.unstubAllGlobals(); cap.maxBytes = undefined; cap.rows = undefined; });

const SECRET = 'zebra-secret-7731';
const PAGE_SQL = 'select name, salary from staff order by name';

/** The fixture's page links plus a dataset only signed-in readers may select, and a table the page builds with `sql`. */
async function exportedPage() {
  const f = await fixture();
  const secret = await publish(f.owner, { dataset: [{ code: SECRET }], title: 'Secret' });
  await storePolicy(secret.body.id, { version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'signed_in', permission: { columns: '*', filter: {} } }] }] });
  const page = await publish(f.owner, { html: `<!doctype html><html><head><title>Staff report</title>
<link rel="af-dataset" data-af-name="staff" href="ref:${f.staff}"><link rel="af-dataset" data-af-name="notes" href="ref:${f.notes}"><link rel="af-dataset" data-af-name="secret" href="ref:${secret.body.id}">
<script src="/af/core.js"></script></head><body><table id="staff"><tbody></tbody></table>
<script type="module">import {sql} from '@afbin/apollo';
const rows=await sql\`${PAGE_SQL}\`;
document.querySelector('#staff tbody').innerHTML=rows.map(r=>'<tr><td>'+r.name+'</td><td>'+r.salary+'</td></tr>').join('');</script></body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { ...f, page: page.body.id };
}

async function exported(page: string, who: Pick<Person, 'token'> | null) {
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
  // A document always has an address. Without one the engine warns as it starts, each stack frame naming this module's
  // multi-megabyte data: URL: 77 MB of output, which hung the CI runner (runs 42868198102, 42868526006).
  vi.stubGlobal('location', { hash: '', href: 'file:///export.html' }); vi.stubGlobal('navigator', {});
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
  const html = await exported(f.page, f.owner);
  const { runtime, refused, data } = await openOffline(html);
  expect(data!.tables.map((t) => `${t.schema}.${t.name}`).sort()).toEqual(['main.notes', 'main.secret', 'main.staff']);
  expect([...await runtime.sql([PAGE_SQL] as unknown as TemplateStringsArray)]).toEqual([{ name: 'ada', salary: 10 }, { name: 'bo', salary: 20 }]);
  // Bound values, aggregates and joins read as the door reads them.
  expect([...await runtime.sql`select count(*) as n from staff where salary > ${15}`]).toEqual([{ n: 1 }]);
  expect([...await runtime.sql`select n.note, count(s.name) as c from notes n, staff s group by n.note`]).toEqual([{ note: 'hello', c: 2 }]);
  // A copy reads; it never writes, and refuses what the door refuses.
  expect(await reject(runtime.sql`insert into staff (name) values (${'x'})`)).toBe('permission_denied');
  expect(await reject(runtime.sql`select * from sqlite_master`)).toBe('validation_failed');
  expect(refused).not.toHaveBeenCalled();
  // A copy's own tables say nothing of where their rows came from; the same tables carried as a draft carries its CSVs,
  // each with its file, say which files a read used (contracts sql-source `file`).
  expect((await runtime.sql`select name from staff` as unknown as { source?: unknown }).source).toBeUndefined();
  const block = /(<script type="application\/json" data-af="offline-data">)([^<]*)(<\/script>)/;
  const carried = JSON.parse(block.exec(html)![2]!) as { tables: Array<{ name: string; file?: string }> };
  for (const table of carried.tables) table.file = `data/${table.name}.csv`;
  const draft = await openOffline(html.replace(block, (_all, open, _data, close) => open + JSON.stringify(carried).replace(/</g, '\\u003c') + close));
  expect((await draft.runtime.sql`select count(*) as n from staff` as unknown as { source?: unknown }).source).toEqual({ kind: 'file', names: ['data/staff.csv'] });
  expect((await draft.runtime.sql`select n.note from notes n, staff s` as unknown as { source?: unknown }).source).toEqual({ kind: 'file', names: ['data/notes.csv', 'data/staff.csv'] });
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
});

it('keeps the exact UTF-8 attachment ceiling and falls back to addresses before dropping SQL', async () => {
  const owner = await mintAccountToken('offline-size-ladder');
  const create = await POST(request('/api/artifacts', {
    method: 'POST', token: owner.token, headers: { 'Idempotency-Key': 'offline_size_ladder_01' },
    json: {
      visibility: 'private',
      html: '<link rel="stylesheet" href="./theme.css"><a id="paper" href="./paper.pdf">Résumé</a>',
      publicationBundle: { entryPath: 'index.html', files: [
        { path: 'theme.css', contentType: 'text/css', base64: Buffer.from('a{color:green}').toString('base64') },
        { path: 'paper.pdf', contentType: 'application/pdf', base64: Buffer.from('%PDF-1.4\n%' + 'x'.repeat(1024) + '\n%%EOF\n').toString('base64') },
      ] },
    },
  }));
  expect(create.status).toBe(201);
  const { id } = await create.json() as { id: string };
  const builds = vi.mocked(esbuild.build);
  const cssBuilds = () => builds.mock.calls.filter(([options]) =>
    options.stdin?.loader === 'css' && options.plugins?.some(plugin => plugin.name === 'admitted-offline-only'),
  ).length;
  builds.mockClear();
  cap.rows = '';
  const small = await exported(id, owner);
  expect(small).toContain('id="paper" href="data:application/pdf;base64,');
  expect(cssBuilds()).toBe(1);

  // '<' adds six bytes once escaped in the SQL block; 'é' adds two UTF-8 bytes.
  const ceiling = 25 * 1024 * 1024;
  const remaining = ceiling - Buffer.byteLength(small) - 2;
  cap.rows = '<'.repeat(Math.floor(remaining / 6)) + 'a'.repeat(remaining % 6) + 'é';
  builds.mockClear();
  const at = await exported(id, owner);
  expect(Buffer.byteLength(at)).toBe(ceiling);
  expect(at).toContain('id="paper" href="data:application/pdf;base64,');
  expect(cssBuilds()).toBe(1);

  cap.rows += 'a';
  builds.mockClear();
  const fallback = await exported(id, owner);
  expect(fallback).toContain('id="paper" href="http');
  expect(fallback).toContain('data-af="offline-sql"');
  expect(fallback).toContain('href="data:text/css;base64,');
  expect(Buffer.byteLength(fallback)).toBeLessThanOrEqual(ceiling);
  expect(cssBuilds()).toBe(1);

  cap.rows += 'a'.repeat(ceiling - Buffer.byteLength(fallback) + 1);
  builds.mockClear();
  const withoutSql = await exported(id, owner);
  expect(withoutSql).toContain('id="paper" href="http');
  expect(withoutSql).not.toContain('data-af="offline-data">');
  expect(withoutSql).not.toContain('data-af="offline-sql">');
  expect(cssBuilds()).toBe(1);
});
