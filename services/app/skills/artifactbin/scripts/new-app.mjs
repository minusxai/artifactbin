/** Command: a shared-app starter (shared-app, shared-list or api-dashboard.html) in one call. */
export const DESCRIPTION = `Set up a shared-app starter in one call: files, datasets, rules, ids.
--kind budget (default): copies examples/shared-app.html as index.html, with budget.ts,
  steps.mjs, guest.mjs and cleanup.mjs (its steps files), into the project; writes
  transactions.csv (generated sample rows or your --data CSV) and targets.csv; publishes both as
  datasets; gives targets the starter's rules (everyone reads; viewer and signed_in write).
--kind list: copies examples/shared-list.html as index.html with its steps, guest and cleanup
  files; publishes an empty entries dataset (name, choice, note, created_by) with own-rows rules
  (everyone reads; signed-in people add entries and change or remove only their own).
--kind api: copies examples/api-dashboard.html as index.html with its steps files and
  api-dashboard.ts as api.ts, a resolver reading --url with the API_KEY secret; publishes an
  empty notes dataset (item, note, created_by) with the same own-rows rules.
All fill the ref: ids and title into index.html.
Usage: node scripts/new-app.mjs [--kind budget|list|api] --title NAME [--data FILE.csv]
  [--url URL] [--dir DIR]
Flags: --kind budget (a shared budget dashboard), list (a sign-up sheet, RSVP or roster) or api
  (a dashboard of an HTTP API's items behind a key, with shared notes);
  --title NAME the app's name, for <title> (a bare title argument works too);
  --data FILE.csv budget only: your own rows (date, merchant, category, amount, payer) instead
  of sample rows; --url URL api only: the API's https:// address that answers a JSON list;
  --dir DIR the project directory (default: the current one; created when missing).
  Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/new-app.mjs --title "Trip budget"
  node scripts/new-app.mjs --title "Our spending" --data ~/Downloads/spending.csv
  node scripts/new-app.mjs --kind list --title "Riverside cleanup volunteers"
  node scripts/new-app.mjs --kind api --url https://api.example.com/v1/orders --title "Orders"
Gotchas: a rerun is safe: an existing file is kept (and listed as kept), never overwritten, and
  the datasets their .af.json companions record are reused, so nothing is created twice. The
  steps, guest, cleanup and policy files need no reading or editing; neither does budget.ts. A
  --data CSV with other column names: map APP.columns to its fields (graphql.mjs schema ID lists
  them). The API's key never goes on the command line or into a file: only the page owner sets
  it, in the page's Resolvers settings.
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed); 3 auth/access (sign in, then
  rerun); 5 unknown write outcome (the error names the journal for publish.mjs --resume).
  Results never contain credentials.`;

import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runTool,ToolError,makeClient,selectedServer,serverOrigin,optionalFile} from
  './toolbox-client.mjs';
import {sharedTargetsPolicy,SUMMARY} from '../examples/shared-app-policy.mjs';
import {EXAMPLES,CHECK,resolve,create,dataset,fill,apiUrl,ownRowsApp} from
  './toolbox-new-app.mjs';

/** Starter file → its name in the project (the names the starter's check command uses). */
const FILES = [['shared-app.html', 'index.html'], ['budget.ts', 'budget.ts'],
  ['shared-app-steps.mjs', 'steps.mjs'], ['shared-app-guest.mjs', 'guest.mjs'],
  ['shared-app-cleanup.mjs', 'cleanup.mjs']];
const ROLES = ['date', 'merchant', 'category', 'amount', 'payer'];
const USAGE = 'node scripts/new-app.mjs --title NAME';

const rowsOf = csv => csv.trim().split(/\r?\n/).length - 1;
/** JSON with keys sorted at every level: the server stores a policy's keys in its own order. */
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' &&
  !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) :
  item);
/** The CSV to publish as transactions: your --data file, or the seeded sample generator's. */
async function transactions(base, data) {
  if (data !== undefined) {
    const bytes = await readFile(resolve(base, data), 'utf8').catch(error => {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      throw new ToolError('data_not_found', `No CSV file at ${data}.`, 2,
        `Pass the CSV's path: ${USAGE} --data ./FILE.csv (or drop --data for sample rows).`);
    });
    if (rowsOf(bytes) < 1) throw new ToolError('data_empty', `${data} has no data rows.`, 2,
      'Pass a CSV with a header line and at least one row, or drop --data for sample rows.');
    return bytes.endsWith('\n') ? bytes : bytes + '\n';
  }
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('gen-transactions.mjs',
    EXAMPLES))], {encoding: 'utf8'});
  if (run.status !== 0) throw new ToolError('sample_failed', 'The sample generator failed.', 1,
    'Download the skill zip again and extract its whole artifactbin/ folder.');
  return run.stdout;
}
/** Gives the targets dataset the starter's rules; nothing is written when they already hold. */
async function applyRules(client, id) {
  const route = `/api/artifacts/${id}/policy`, read = await client.request(route);
  const policy = sharedTargetsPolicy(read.policy);
  if (canonical(policy.tables) === canonical(read.policy.tables)) return false;
  await client.request(route, {method: 'PUT', unsafe: true, safeToRepeat: false,
    body: {policy, expectedPolicyRevision: read.revision}});
  return true;
}
export async function newAppCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw new ToolError('missing_title', 'The app needs a name.', 2, 'Run ' + USAGE);
  const base = options.cwd ?? process.cwd(), dir = resolve(base, values.dir ?? '.');
  const server = serverOrigin(selectedServer(values, options.env));
  const at = name => path.join(dir, name), created = [], kept = [];
  const kind = values.kind ?? 'budget';
  if (!['budget', 'list', 'api'].includes(kind)) throw new ToolError('invalid_kind',
    `--kind ${kind} is not a starter.`, 2, 'Use --kind budget, --kind list or --kind api.');
  if (kind !== 'api' && values.url !== undefined) throw new ToolError('url_not_for_kind',
    `--url is for --kind api: --kind ${kind} reads no API.`, 2, 'Drop --url, or use --kind api.');
  if (kind !== 'budget') {
    const url = kind === 'api' ? apiUrl(values.url) : undefined;
    if (values.data !== undefined) throw new ToolError(`data_not_for_${kind}`, kind === 'list' ?
      'A list starts empty: people add the entries.' : 'The items come from the API: people ' +
      'add the notes.', 2, 'Drop --data and rerun.');
    return ownRowsApp(kind, {title, dir, at, server, options, url});
  }
  const rows = await transactions(base, values.data);
  const existing = await optionalFile(at('transactions.csv'));
  if (values.data !== undefined && existing && String(existing) !== rows) {
    const companion = await optionalFile(at('transactions.csv.af.json'));
    throw new ToolError('data_conflict', `${at('transactions.csv')} already holds other rows.`, 2,
      'Drop --data to keep them, or move them aside and rerun: mv transactions.csv ' +
      'old-transactions.csv' + (companion ? ' && mv transactions.csv.af.json ' +
      'old-transactions.csv.af.json' : ''));
  }
  await mkdir(dir, {recursive: true});
  const starter = await readFile(new URL('shared-app.html', EXAMPLES), 'utf8');
  const [, category, amount] = /defaultTargets:\s*\{\s*'?([^':,]+)'?\s*:\s*([\d.]+)/
    .exec(starter) ?? [, 'Rent', '1650'];
  const outputs = [...await Promise.all(FILES.map(async ([from, to]) => [to,
    await readFile(new URL(from, EXAMPLES))])), ['transactions.csv', rows],
    ['targets.csv', `category,amount\n${category},${amount}\n`]];
  for (const [name, bytes] of outputs) (await create(at(name), bytes) ? created : kept).push(name);
  const sample = values.data === undefined ? ' (sample)' : '';
  const tx = await dataset(at('transactions.csv'), `${title} transactions${sample}`, server,
    options);
  const tg = await dataset(at('targets.csv'), `${title} targets`, server, options);
  const rulesSet = await applyRules(makeClient(server, options), tg.id);
  const page = await readFile(at('index.html'), 'utf8'), filledPage = fill(page, starter,
    {title, ids: {transactions: tx.id, targets: tg.id}, data: values.data !== undefined});
  if (filledPage !== page) await writeFile(at('index.html'), filledPage);
  const header = String(await readFile(at('transactions.csv'))).split(/\r?\n/)[0]
    .toLowerCase().split(',').map(name => name.trim());
  const missing = ROLES.filter(role => !header.includes(role));
  const datasets = {
    transactions: {id: tx.id, rows: rowsOf(String(await readFile(at('transactions.csv')))),
      reused: tx.reused},
    targets: {id: tg.id, rows: rowsOf(String(await readFile(at('targets.csv')))), reused: tg.reused}
  };
  const note = [created.length ? `created ${created.join(', ')}` : '',
    kept.length ? `kept ${kept.join(', ')} (already there; not overwritten)` : '',
    `transactions ${tx.id} (${datasets.transactions.rows} rows${tx.reused ? ', reused' : ''})`,
    `targets ${tg.id} (${tg.reused ? 'reused; ' : ''}rules ${rulesSet ? 'set' : 'already set'}: ` +
      `${SUMMARY})`,
    filledPage !== page ? 'index.html now links both and is titled ' + JSON.stringify(title) : ''
  ].filter(Boolean).join('; ') + '.';
  const edit = values.data === undefined ? 'its [bracketed] text and defaultTargets (plausible ' +
    'monthly amounts)' : 'its [bracketed] text, columns and defaultTargets (your categories)' +
    (missing.length ? ` (no ${missing.join('/')} column: node scripts/graphql.mjs schema ` +
    `${tx.id} lists the fields)` : '');
  return {project: dir, title, created, kept, datasets, rules: `targets: ${SUMMARY}`, note,
    next: `Next: in index.html edit only APP: ${edit}; then ${CHECK}`};
}
await runTool('new-app', import.meta.url, newAppCommand);
