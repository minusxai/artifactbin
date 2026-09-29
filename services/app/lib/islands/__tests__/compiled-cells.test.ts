/**
 * EDITABLE DATATABLE CELLS ON A COMPILED PAGE, END TO END THROUGH THE SHIPPED BUILD (w3-cells-assets).
 *
 * Today's reader draws a `<Column>`'s content in every row, and a control there with `run="$mutation"` is an
 * editing cell (StoryRuntimeApp RuntimeCellControl): a draft per cell that survives the row re-rendering, a
 * write on commit with the row and the draft as `$_value`, `aria-busy` while it saves, the server's refusal in
 * a `role="alert"` beside it, and — for a reader who may not write — the cell disabled with the reason on it.
 *
 * Server half: the compiler generates the page and its SSR module renders it (fixtures/compiled-cells.server.ts,
 * the shared build's real server half). Browser half: the generated islands compiled `generate: 'dom'`,
 * hydratable, evaluated against the SHIPPED browser chunks (public/islands) and hydrated in place — what a
 * reader's browser runs. The refused cells are compared with today's reader's DOM for the same document
 * (fixtures/editable-cells, captured from `/raw?reader=legacy`): tags, attributes (class strings in order),
 * text — the parity gate's comparison.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { MutationRequest } from '@/lib/story/mutation-request';
import { EDITABLE_CELLS_BODY, EDITABLE_CELLS_REFUSAL, EDITABLE_CELLS_ROWS, LEGACY_REFUSED_CELLS } from './fixtures/editable-cells';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const PUBLIC = path.join(ROOT, 'services/app/public');

const MUTATIONS = ['item', 'hours', 'note', 'status', 'pick', 'tags', 'due'];
const HELMET = '<Helmet><Import name="t" src="ref:CELLS1" />'
  + '<Query name="rows">{`select *, status as pick, \'\' as action, \'\' as label from t.rows order by id`}</Query>'
  + MUTATIONS.map((f) => `<Mutation name="set_${f}" expectedAffected={1}>{\`update t.rows set ${f === 'pick' ? 'status' : f}=$_value where id=$_row.id\`}</Mutation>`).join('')
  + '<Mutation name="complete" expectedAffected={1}>{`update t.rows set status=\'done\' where id=$_row.id`}</Mutation></Helmet>';
/** The dataset's columns, and the query's (`select *` plus the three computed ones). */
const DATASET = [
  { name: 'id', type: 'number' }, { name: 'item', type: 'string' }, { name: 'hours', type: 'number' }, { name: 'note', type: 'string' }, { name: 'status', type: 'string' },
  { name: 'tags', type: 'string' }, { name: 'due', type: 'date' },
];
const COLUMNS = [...DATASET, { name: 'pick', type: 'string' }, { name: 'action', type: 'string' }, { name: 'label', type: 'string' }];
/** The guest snapshot the page is served with: the rows are in the first paint, and the cells are hydrated in place. */
const SNAPSHOT = { tables: { rows: { rows: EDITABLE_CELLS_ROWS, columns: COLUMNS } }, errors: {} };

interface ServerHalf { html: string; islands: string; browserCode: string; flow: CompiledDataflow }
let cached: ServerHalf | null = null;
function serverHalf(): ServerHalf {
  if (cached) return cached;
  const out = execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-cells.server.ts', HELMET + EDITABLE_CELLS_BODY, JSON.stringify(DATASET), JSON.stringify(SNAPSHOT)], { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  cached = JSON.parse(out.toString('utf8')) as ServerHalf;
  return cached;
}

async function shipped(spec: string): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(readFileSync(path.join(PUBLIC, 'islands/manifest.json'), 'utf8')) as { manifest: Record<string, string> };
  const url = manifest.manifest[spec];
  if (!url) throw new Error(`the island build has no ${spec}`);
  return import(/* @vite-ignore */ pathToFileURL(path.join(PUBLIC, url)).href) as Promise<Record<string, unknown>>;
}

const until = async (ok: () => boolean, what: string | (() => string)) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!ok()) throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
};

interface Page {
  host: HTMLElement;
  written: MutationRequest[];
  /** Answer the next write: resolve (saved) or reject with the server's message. */
  settle: Array<(error?: string) => void>;
  refresh(): void;
  dispose(): void;
}
let open: Page | null = null;
afterEach(() => { open?.dispose(); open = null; });

/** The compiled page, hydrated over a transport that answers the rows and the write check (`refusal` for every mutation, or none). */
async function page(refusal: string | null): Promise<Page> {
  const server = serverHalf();
  const host = document.createElement('div');
  host.innerHTML = server.html;
  document.body.append(host);
  const pageData = document.createElement('script');
  pageData.id = 'mx-story-data'; pageData.type = 'application/json';
  pageData.textContent = host.querySelector('script[data-mx-module-data]')?.textContent ?? '{}';
  document.body.append(pageData);
  const rt = await shipped('@mx/rt');
  const manifest = loadCompilerBuild().manifest;
  const kits = new Map<string, Record<string, unknown>>();
  for (const spec of new Set([...server.islands.matchAll(/from "(@mx\/kit\/[a-z-]+)"/g)].map((m) => m[1]!))) kits.set(manifest[spec]!, await shipped(spec));
  let tree: unknown = null;
  await evaluateModule(server.browserCode, (spec) => spec === manifest['@mx/rt'] ? rt : spec === manifest['@mx/boot']
    ? { boot: (value: { TREE: unknown }) => { tree = value.TREE; } }
    : kits.get(spec) ?? (() => { throw new Error(`unexpected import ${spec}`); })(), 'test/islands.js');
  let markHydrated!: () => void; const hydrated = new Promise<void>((r) => { markHydrated = r; });
  const rows = EDITABLE_CELLS_ROWS.map((r) => ({ ...r }));
  const written: MutationRequest[] = [];
  const settle: Page['settle'] = [];
  const access = Object.fromEntries([...MUTATIONS.map((f) => `set_${f}`), 'complete'].map((m) => [m, refusal]));
  const transport = {
    run: async () => { await hydrated; return ({ tables: { rows: { rows: rows.map((r) => ({ ...r, pick: r.status })), columns: COLUMNS } }, errors: {}, mutationAccess: access }); },
    page: async () => ({ rows: [], columns: [] }),
    mutate: (request: MutationRequest) => new Promise<{ dataset: string }>((resolve, reject) => {
      written.push(request);
      settle.push((error) => {
        if (error) { reject(new Error(error)); return; }
        // The dataset takes the write, so the re-run that follows it carries the saved value.
        const field = request.mutation === 'set_pick' ? 'status' : request.mutation.slice('set_'.length);
        const target = rows.find((r) => r.id === request.row?.id);
        if (target && request.value !== undefined) (target as Record<string, unknown>)[field] = request.value;
        resolve({ dataset: 'CELLS1' });
      });
    }),
  };
  const runtime = (rt.createIslandRuntime as (d: unknown, s: (i: unknown) => unknown) => { context: unknown; store: { start(): void; invalidateDatasets(ids: string[]): void } | null; dispose(): void })(
    { dataflow: { flow: server.flow, values: {}, results: SNAPSHOT }, viewer: null }, (input) => (rt.createDataflowStore as (i: unknown, o: unknown) => unknown)(input, { transport }));
  runtime.store?.start();
  const disposeTree = (rt.hydrateIsland as (r: string, c: unknown, x: unknown, p: ParentNode) => (() => void) | null)('d-', tree, runtime.context, host);
  markHydrated();
  await until(() => !!host.querySelector('[aria-label="Item 1"]'), 'the first row\'s cells');
  const result = { host, written, settle, refresh: () => runtime.store?.invalidateDatasets(['CELLS1']), dispose: () => { disposeTree?.(); runtime.dispose(); pageData.remove(); host.remove(); } };
  open = result;
  return result;
}

const cellOf = (host: ParentNode, table: string, column: string, row = 1) =>
  [...host.querySelectorAll(`[data-mx-comment-owner="${table}"] td`)].find((td) => {
    const target = JSON.parse(td.getAttribute('data-mx-comment-target') ?? '{}') as { rowKey?: unknown; columnKey?: unknown };
    return target.rowKey === row && target.columnKey === column;
  }) as HTMLTableCellElement | undefined;

/** A DOM subtree as the parity gate compares it: tags, attribute sets (values exact, `data-hk` dropped), direct text. */
interface Shape { tag: string; attrs: string[]; text: string; kids: Shape[] }
const shapeOf = (el: Element): Shape => ({
  tag: el.tagName.toLowerCase(),
  attrs: [...el.attributes].filter((a) => a.name !== 'data-hk').map((a) => `${a.name}=${a.value}`).sort(),
  text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''),
  kids: [...el.children].map(shapeOf),
});
const shapesOf = (html: string): Shape[] => { const t = document.createElement('template'); t.innerHTML = html; return [...t.content.children].map(shapeOf); };

describe('editable cells on the compiled page', () => {
  it('keeps a draft when its focused row is detached by virtualization', async () => {
    const { host, written } = await page(null);
    const input = cellOf(host, 'tbl', 'item')!.querySelector('input')!;
    await until(() => !input.disabled, 'the write check');
    input.focus(); input.value = 'survives scroll'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur(); input.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(written).toEqual([]);
  });
  it('does not report an invalid blur after another cell opens', async () => {
    const { host, written } = await page(null);
    const input = cellOf(host, 'tbl', 'hours')!.querySelector('input')!;
    await until(() => !input.disabled, 'the write check');
    input.focus(); input.value = '-1'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const report = vi.spyOn(input, 'reportValidity');
    input.blur();
    cellOf(host, 'tbl', 'status', 2)!.querySelector('button')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(report).not.toHaveBeenCalled();
    expect(document.querySelector('[role="listbox"][aria-label="Status 2"]')).toBeTruthy();
    expect(written).toEqual([]);
  });
  it('keeps a cell menu mounted through an unrelated data refresh', async () => {
    const { host, refresh } = await page(null);
    await until(() => !cellOf(host, 'tbl', 'status')!.querySelector('button')!.disabled, 'the write check');
    cellOf(host, 'tbl', 'status')!.querySelector('button')!.click();
    const popup = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Status 1"]')?.parentElement;
    expect(popup?.style.position).toBe('fixed');
    refresh();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(popup?.isConnected).toBe(true);
    expect(document.querySelector('[role="listbox"][aria-label="Status 1"]')?.parentElement).toBe(popup);
  });
  it('draws the disabled cell reason on hover and focus', async () => {
    const { host } = await page(EDITABLE_CELLS_REFUSAL);
    await until(() => cellOf(host, 'tbl', 'item')?.querySelector('input')?.getAttribute('aria-description') === EDITABLE_CELLS_REFUSAL, 'the write check');
    const trigger = cellOf(host, 'tbl', 'item')!.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]')!;
    trigger.dispatchEvent(new Event('pointermove', { bubbles: true }));
    await until(() => document.querySelector('[role="tooltip"]')?.textContent?.includes(EDITABLE_CELLS_REFUSAL) ?? false, 'the hovered cell tooltip');
    trigger.dispatchEvent(new Event('pointerleave', { bubbles: true }));
    trigger.focus();
    await until(() => document.querySelector('[role="tooltip"]')?.textContent?.includes(EDITABLE_CELLS_REFUSAL) ?? false, 'the focused cell tooltip');
  });
  it('a reader who may not write sees today\'s refused cells, element for element', async () => {
    const { host } = await page(EDITABLE_CELLS_REFUSAL);
    await until(() => cellOf(host, 'tbl', 'item')?.querySelector('input')?.getAttribute('aria-description') === EDITABLE_CELLS_REFUSAL, 'the write check');
    for (const [table, columns] of Object.entries(LEGACY_REFUSED_CELLS)) {
      for (const [column, legacy] of Object.entries(columns)) {
        const td = cellOf(host, table, column);
        expect(td, `${table}.${column}`).toBeTruthy();
        expect(shapesOf(td!.innerHTML), `${table}.${column}`).toEqual(shapesOf(legacy));
      }
    }
  });

  it('a writer\'s cells are enabled, with nothing on the hint', async () => {
    const { host } = await page(null);
    await until(() => !(cellOf(host, 'tbl', 'item')?.querySelector('input') as HTMLInputElement | null)?.disabled, 'the write check');
    const hint = cellOf(host, 'tbl', 'status')!.querySelector('[data-slot="tooltip-trigger"]')!;
    expect([hint.getAttribute('tabindex'), hint.getAttribute('aria-description'), hint.getAttribute('data-state')]).toEqual([null, null, 'closed']);
    expect(cellOf(host, 'tbl', 'status')!.querySelector('button')!.hasAttribute('disabled')).toBe(false);
    expect(cellOf(host, 'tbl', 'due')!.querySelector('button')!.hasAttribute('disabled')).toBe(false);
    expect(cellOf(host, 'tbl', 'pick')!.querySelector('select')!.disabled).toBe(false);
  });

  it('a Select cell writes the chosen option with its row, is busy while it saves, and shows a refusal beside it', async () => {
    const { host, written, settle } = await page(null);
    await until(() => !cellOf(host, 'tbl', 'status')!.querySelector('button')!.disabled, 'the write check');
    cellOf(host, 'tbl', 'status')!.querySelector('button')!.click();
    await until(() => !!document.querySelector('[role="listbox"][aria-label="Status 1"]'), 'the list');
    const listbox = document.querySelector('[role="listbox"][aria-label="Status 1"]')!;
    // Portaled out of the table's scroll box, fixed beside its trigger (today's popupHost + useAnchoredPopup).
    expect(listbox.closest('[data-slot="data-table"]')).toBeNull();
    expect((listbox.parentElement as HTMLElement).style.position).toBe('fixed');
    (listbox.querySelector('[role="option"][aria-label="active"]') as HTMLButtonElement).click();
    await until(() => written.length === 1, 'the write');
    expect(written[0]).toMatchObject({ mutation: 'set_status', value: 'active', row: { id: 1 } });
    const root = () => cellOf(host, 'tbl', 'status')!.querySelector('.mx-control')!;
    await until(() => root().getAttribute('aria-busy') === 'true', 'the saving state');
    expect(root().querySelector('button')!.disabled).toBe(true);
    expect(root().querySelector('.truncate')!.textContent).toBe('active');
    settle[0]!('row_changed');
    await until(() => !!cellOf(host, 'tbl', 'status')!.querySelector('[role="alert"]'), 'the refusal');
    const alert = cellOf(host, 'tbl', 'status')!.querySelector('[role="alert"]')!;
    expect([alert.className, alert.textContent]).toEqual(['mx-write-error', 'row_changed']);
    // Inside the hint, after the control, as today's cell draws it (MutationCellHint holds the control and the refusal).
    expect(alert.closest('[data-slot="tooltip-trigger"]')).not.toBeNull();
    expect(alert.previousElementSibling).toBe(root());
    expect(root().hasAttribute('aria-busy')).toBe(false);
    expect(root().querySelector('.truncate')!.textContent, 'the draft is kept').toBe('active');
    cellOf(host, 'tbl', 'status', 2)!.querySelector('button')!.click();
    await until(() => !!document.querySelector('[role="listbox"][aria-label="Status 2"]'), 'the other cell menu after a refusal');
  });

  it('a text cell keeps its draft, writes on Enter, and Escape puts the saved value back', async () => {
    const { host, written, settle } = await page(null);
    const input = () => cellOf(host, 'tbl', 'item')!.querySelector('input')!;
    await until(() => !input().disabled, 'the write check');
    input().focus();
    input().value = 'Gamma';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    input().dispatchEvent(new Event('change', { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => input().value === 'Alpha', 'the cancel');
    expect(written).toEqual([]);
    input().focus();
    input().value = 'Gamma';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => written.length === 1, 'the write');
    expect(written[0]).toMatchObject({ mutation: 'set_item', value: 'Gamma', row: { id: 1 } });
    // Today's native cell is disabled while its write is in flight (it carries no aria-busy of its own).
    expect(input().disabled).toBe(true);
    settle[0]!();
    await until(() => !input().disabled, 'the save (the re-run carries the saved value)');
    expect(input().value).toBe('Gamma');
  });

  it('a number cell never writes an invalid number, and an intentional clear writes null', async () => {
    const { host, written } = await page(null);
    const input = () => cellOf(host, 'tbl', 'hours')!.querySelector('input')!;
    await until(() => !input().disabled, 'the write check');
    input().focus();
    input().value = '-1';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(written, 'below min={0}: the field reports and nothing is written').toEqual([]);
    input().value = '';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => written.length === 1, 'the clear');
    expect(written[0]).toMatchObject({ mutation: 'set_hours', value: null });
  });

  it('a multiple Select collects a draft and writes it as a JSON array on Done', async () => {
    const { host, written } = await page(null);
    const trigger = () => cellOf(host, 'tbl', 'tags')!.querySelector('button')!;
    await until(() => !trigger().disabled, 'the write check');
    trigger().click();
    await until(() => !!document.querySelector('[role="listbox"][aria-label="Tags 1"]'), 'the list');
    const listbox = document.querySelector('[role="listbox"][aria-label="Tags 1"]')!;
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    (listbox.querySelector('[role="option"][aria-label="ux"]') as HTMLButtonElement).click();
    expect(written).toEqual([]);
    (document.querySelector('button[aria-label="Done"]') as HTMLButtonElement).click();
    await until(() => written.length === 1, 'the write');
    expect(written[0]).toMatchObject({ mutation: 'set_tags', value: '["feature","ux"]', row: { id: 1 } });
  });

  it('a DatePicker cell writes the picked day at once', async () => {
    const { host, written } = await page(null);
    const trigger = () => cellOf(host, 'tbl', 'due')!.querySelector('button')!;
    await until(() => !trigger().disabled, 'the write check');
    trigger().click();
    await until(() => !!document.querySelector('[role="dialog"][aria-label="Due 1 calendar"]'), 'the calendar');
    (document.querySelector('[role="dialog"][aria-label="Due 1 calendar"] button[aria-label="2026-01-15"]') as HTMLButtonElement).click();
    await until(() => written.length === 1, 'the write');
    expect(written[0]).toMatchObject({ mutation: 'set_due', value: '2026-01-15', row: { id: 1 } });
  });

  it('a native select cell writes its choice with the column\'s type', async () => {
    const { host, written } = await page(null);
    const select = () => cellOf(host, 'tbl', 'pick')!.querySelector('select')!;
    await until(() => !select().disabled, 'the write check');
    expect(select().value).toBe('backlog');
    select().value = 'done';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => written.length === 1, 'the write');
    expect(written[0]).toMatchObject({ mutation: 'set_pick', value: 'done', row: { id: 1 } });
  });
});
