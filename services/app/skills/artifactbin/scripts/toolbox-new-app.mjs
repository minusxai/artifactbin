/**
 * Internal: what new-app.mjs's starters share (files copied without overwriting, a dataset
 * published once and reused through its companion, the page's placeholders filled) and the
 * --kind api starter whole (an HTTP API's items with shared notes, read by a resolver whose key
 * only the page owner sets). The tracker's trimming is toolbox-tracker.mjs.
 * Used by: new-app.mjs.
 */
import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {ToolError,optionalFile} from './toolbox-client.mjs';
import {publishCommand} from './toolbox-publish.mjs';
import {dataBaseline} from './toolbox-publish-guard.mjs';

export const EXAMPLES = new URL('../examples/', import.meta.url);
export const CHECK = 'node scripts/publish.mjs index.html && node scripts/check.mjs index.html ' +
  '--steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs';
export const resolve = (base, file) => path.resolve(base, String(file)
  .replace(/^~(?=$|[\\/])/, homedir()));
const htmlText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const API_URL = 'node scripts/new-app.mjs --kind api --url https://HOST/PATH --title NAME';
/** Starter file → its name in the project, the dataset each own-rows kind starts empty, what to
 * edit and who may do what. */
const KINDS = {
  api: {page: 'api-dashboard.html', files: ['steps', 'guest', 'cleanup'], table: 'notes',
    columns: 'item,note,created_by', what: 'notes', resolver: ['api-dashboard.ts', 'api.ts'],
    edit: "fields (the API's field names), only and its [bracketed] text"}
};

/** Writes FILE only when nothing is there yet; false when it was kept. */
export async function create(file, bytes) {
  try { await writeFile(file, bytes, {flag: 'wx'}); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
/** The dataset FILE's companion records, or a new one published from it (extra: publish flags). */
export async function dataset(file, title, server, options, extra = {}) {
  const companion = await optionalFile(file + '.af.json');
  if (companion) return {id: dataBaseline(companion, file, server).id, reused: true};
  const done = await publishCommand({values: {server, title, ...extra}, positionals: [file]},
    options);
  return {id: done.id, reused: false};
}
/** index.html with the starter's placeholders that are still there replaced. */
export function fill(html, starter, {title, ids}) {
  const placeholder = /<title>(\[[^\]<]+\])<\/title>/.exec(starter)?.[1];
  const out = html.replaceAll('ref:DATASET_ID', 'ref:' + ids.own);
  return placeholder ? out.replaceAll(`<title>${placeholder}</title>`,
    `<title>${htmlText(title)}</title>`) : out;
}
/** A DNS name a secret may be bound to: two labels or more, the last alphabetic (no IP). */
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;
/** --url for --kind api: an HTTPS address on port 443 at a host name, which a resolver may fetch
 * with a secret. */
export function apiUrl(raw) {
  if (raw === undefined) throw new ToolError('missing_url', 'The API starter needs the ' +
    "API's address.", 2, `Pass it: ${API_URL} (the key stays out: the owner sets it later).`);
  let url = null;
  try { url = new URL(String(raw)); } catch {}
  if (url?.protocol !== 'https:' || url.port || url.username || url.password ||
    !HOST_NAME.test(url.hostname)) throw new ToolError('invalid_url', `${raw} is not an ` +
    'https:// address at a host name, without a port or credentials.', 2, 'A resolver reaches ' +
    `HTTPS on port 443 only, at a public host name: ${API_URL}`);
  return url;
}
/** An own-rows starter: its files, an empty dataset with own-rows rules, the filled page. */
export async function ownRowsApp(kind, {title, dir, at, server, options, url}) {
  const spec = KINDS[kind], created = [], kept = [];
  await mkdir(dir, {recursive: true});
  const starter = await readFile(new URL(spec.page, EXAMPLES), 'utf8');
  const copied = [[spec.page, 'index.html'], ...spec.resolver ? [spec.resolver] : [],
    ...spec.files.map(name => [spec.page.replace('.html', `-${name}.mjs`), name + '.mjs'])];
  const outputs = [...await Promise.all(copied.map(async ([from, to]) => [to,
    await readFile(new URL(from, EXAMPLES), 'utf8')])), [spec.table + '.csv', spec.columns + '\n']];
  // The resolver reads --url: its host is the one the key may go to.
  const quoted = text => `'${text.replace(/[\\']/g, '\\$&')}';`;
  for (const output of outputs) if (url && output[0] === 'api.ts') output[1] = output[1]
    .replace(/^(const HOST = )'[^']*';/m, (_, start) => start + quoted(url.hostname))
    .replace(/^(const PATH = )'[^']*';/m, (_, start) => start + quoted(url.pathname + url.search));
  for (const [name, bytes] of outputs) (await create(at(name), bytes) ? created : kept).push(name);
  const own = await dataset(at(spec.table + '.csv'), `${title} ${spec.table}`, server, options,
    {name: spec.table, template: 'own-rows', 'owner-column': 'created_by'});
  const page = await readFile(at('index.html'), 'utf8'), filledPage = fill(page, starter,
    {title, ids: {own: own.id}});
  if (filledPage !== page) await writeFile(at('index.html'), filledPage);
  const rules = `${spec.table}: everyone reads; signed-in people add ${spec.what} and change or ` +
    'remove only their own';
  const note = [created.length ? `created ${created.join(', ')}` : '',
    kept.length ? `kept ${kept.join(', ')} (already there; not overwritten)` : '',
    `${spec.table} ${own.id} (${own.reused ? 'reused' : 'empty, own-rows rules set'})`,
    filledPage !== page ? 'index.html now links it and is titled ' + JSON.stringify(title) : ''
  ].filter(Boolean).join('; ') + '.';
  const key = !url ? '' : '. Check reports the items Not tested until the API_KEY secret is set: ' +
    "tell the user to paste the key into the page's settings, Resolvers tab, API_KEY, and press " +
    "Test connection (it lists the API's field names); never read the key or write it anywhere.";
  return {project: dir, title, kind, created, kept, datasets: {[spec.table]: {id: own.id, rows: 0,
    reused: own.reused}}, rules, note, next: `Next: in index.html edit only APP: ${spec.edit}; ` +
    `then ${CHECK}${key}`};
}
