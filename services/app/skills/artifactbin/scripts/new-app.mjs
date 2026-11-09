/** Command: a shared tracker (examples/tracker.html, trimmed) or API dashboard, in one call. */
export const DESCRIPTION = `Set up a shared-app starter in one call: files, dataset, rules and id.
--kind tracker (default) writes examples/tracker.html as index.html with only the chosen
  features, plus steps.mjs, guest.mjs and cleanup.mjs (its checks) and, with limits, tracker.ts;
  publishes an empty entries dataset (name, grp, note, created_by; description with collab)
  with the rules the features need. --kind list is the tracker's list preset.
--kind api: copies examples/api-dashboard.html as index.html with its steps files and
  api-dashboard.ts as api.ts, a resolver reading --url with the API_KEY secret; publishes an
  empty notes dataset (item, note, created_by) with own-rows rules.
All fill the ref: id and title into index.html.
Tracker features: own-rows (signed-in people add entries and change or remove only their own);
  team (needs own-rows: people the page is shared with change every entry); collab (an entry's
  description is typed in together); table (a sortable table view); limits (needs own-rows: at
  most --limit entries per group, enforced on the server by tracker.ts).
Usage: node scripts/new-app.mjs --title NAME [--kind tracker|list|api] [--preset tasks|list]
  [--without FEATURE,…] [--limit N] [--url URL] [--dir DIR]
Flags: --title NAME the app's name, for <title> (a bare title argument works too);
  --preset tasks (default: every feature, a team task tracker) or list (own-rows only: a sign-up
  sheet, RSVP or roster); --kind list is --preset list; --without FEATURE,… drops features;
  --limit N the most entries a group holds (limits only; default 5; written to APP.limit and to
  tracker.ts); --kind api (a dashboard of an HTTP API's items behind a key, with shared notes)
  with --url URL the API's https:// address that answers a JSON list; --dir DIR the project
  directory (default: the current one; created when missing). Common: --server ORIGIN, --json,
  --output FILE, --help.
Examples:
  node scripts/new-app.mjs --title "Launch tasks"
  node scripts/new-app.mjs --kind list --title "Riverside cleanup volunteers"
  node scripts/new-app.mjs --title "Bug triage" --without collab,limits
  node scripts/new-app.mjs --title "Workshop seats" --without team,collab,table --limit 12
  node scripts/new-app.mjs --kind api --url https://api.example.com/v1/orders --title "Orders"
Gotchas: an unknown feature, or one whose requirement you drop, is refused (exit 2) with the fix.
  A rerun is safe: an existing file is kept (and listed as kept), never overwritten, and the
  dataset the kept index.html links (its ref:) is reused, so nothing is created twice. The steps,
  guest and cleanup files, tracker.ts and api.ts need no reading or editing. Who may do what
  lives in the dataset's rules (node scripts/policy.mjs explain ID); the page only follows the
  server's _can. The API's key never goes on the command line or into a file: only the page
  owner sets it, in the page's Resolvers settings.
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed); 3 auth/access (sign in, then
  rerun); 5 unknown write outcome (the error names the journal for publish.mjs --resume).
  Results never contain credentials.`;

import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runTool,ToolError,makeClient,selectedServer,serverOrigin} from './toolbox-client.mjs';
import {EXAMPLES,check,resolve,create,dataset,fill,apiUrl,ownRowsApp} from
  './toolbox-new-app.mjs';
import {trackerFeatures,trackerFiles} from './toolbox-tracker.mjs';
import {FEATURES,columns,rules,template} from '../examples/tracker-features.mjs';

const USAGE = 'node scripts/new-app.mjs --title NAME';
const invalid = (code, message, recovery) => new ToolError(code, message, 2, recovery);
/** JSON with keys sorted at every level: the server stores a policy's keys in its own order. */
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' &&
  !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) :
  item);

/** Gives the entries dataset the kept features' rules; nothing is written when they hold. */
async function applyRules(client, id, keep) {
  const route = `/api/artifacts/${id}/policy`, read = await client.request(route);
  const policy = {...read.policy, tables: read.policy.tables.map(table => rules(table, keep))};
  if (canonical(policy.tables) === canonical(read.policy.tables)) return false;
  await client.request(route, {method: 'PUT', unsafe: true, safeToRepeat: false,
    body: {policy, expectedPolicyRevision: read.revision}});
  return true;
}
/** The preset and kept features --kind, --preset and --without name; the --limit they allow. */
function choose(values, kind) {
  if (kind === 'list' && values.preset !== undefined && values.preset !== 'list')
    throw invalid('preset_conflict', '--kind list is the list preset.',
      `Drop --kind list to use --preset ${values.preset}.`);
  const preset = kind === 'list' ? 'list' : values.preset ?? 'tasks';
  const without = String(values.without ?? '').split(',').map(name => name.trim())
    .filter(Boolean);
  const keep = trackerFeatures({preset, without});
  if (values.limit === undefined) return {preset, keep};
  if (!keep.has('limits')) throw invalid('limit_without_limits',
    '--limit needs the limits feature, which this tracker does not keep.',
    'Drop --limit, or keep limits (--preset tasks has it).');
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw invalid('invalid_limit',
    `--limit ${values.limit} is not a whole number from 1 to 1000.`, 'Pass --limit 5, say.');
  return {preset, keep, limit};
}
/** The tracker: the template trimmed to its features, the entries dataset and its rules. */
async function trackerApp(kind, values, {title, dir, at, server, options}) {
  const {preset, keep, limit} = choose(values, kind), created = [], kept = [];
  const files = await trackerFiles(keep, {preset, limit});
  files['entries.csv'] = columns(keep).join(',') + '\n';
  await mkdir(dir, {recursive: true});
  for (const [name, text] of Object.entries(files))
    (await create(at(name), text) ? created : kept).push(name);
  const owned = template(keep) === 'own-rows' ? {template: 'own-rows', 'owner-column':
    'created_by'} : {};
  const entries = await dataset(at('index.html'), at('entries.csv'), `${title} entries`, server,
    options, {name: 'entries', ...owned});
  const rulesSet = keep.has('team') || keep.has('collab') ?
    await applyRules(makeClient(server, options), entries.id, keep) : false;
  const starter = await readFile(new URL('tracker.html', EXAMPLES), 'utf8');
  const page = await readFile(at('index.html'), 'utf8'), filledPage = fill(page, starter,
    {title, ids: {own: entries.id}});
  if (filledPage !== page) await writeFile(at('index.html'), filledPage);
  // Who may do what, from the kept features (a table view changes no rule).
  const said = [...keep].filter(name => name !== 'table')
    .map(name => FEATURES[name].summary.replace('APP.limit', String(limit ?? 5)));
  const rulesText = ['entries: everyone reads', ...keep.has('own-rows') ? [] :
    ['only you and editors change entries'], ...said].join('; ');
  const note = [created.length ? `created ${created.join(', ')}` : '',
    kept.length ? `kept ${kept.join(', ')} (already there; not overwritten)` : '',
    `entries ${entries.id} (${entries.reused ? 'reused' : `empty, ${template(keep)} rules set`}` +
      `${rulesSet ? '; feature rules set' : ''})`,
    filledPage !== page ? 'index.html now links it and is titled ' + JSON.stringify(title) : ''
  ].filter(Boolean).join('; ') + '.';
  const groups = preset === 'list' ? 'the options people pick from' :
    'the stages entries move through';
  return {project: dir, title, kind, preset, features: [...keep], created, kept,
    datasets: {entries: {id: entries.id, rows: 0, reused: entries.reused}},
    ...limit === undefined ? {} : {limit}, rules: rulesText, note,
    next: `Next: in index.html edit only APP: its [bracketed] text and groups (${groups}); ` +
      `then ${await check(at('index.html'))}`};
}
export async function newAppCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw invalid('missing_title', 'The app needs a name.', 'Run ' + USAGE);
  const kind = values.kind ?? 'tracker';
  if (!['tracker', 'list', 'api'].includes(kind)) throw invalid('invalid_kind',
    `--kind ${kind} is not a starter.`, 'Use --kind tracker, --kind list or --kind api.');
  if (kind !== 'api' && values.url !== undefined) throw invalid('url_not_for_kind',
    `--url is for --kind api: --kind ${kind} reads no API.`, 'Drop --url, or use --kind api.');
  if (values.data !== undefined) throw invalid(`data_not_for_${kind}`, kind === 'api' ?
    'The items come from the API: people add the notes.' : 'A tracker starts empty: people ' +
    'add the entries.', 'Drop --data and rerun.');
  const base = options.cwd ?? process.cwd(), dir = resolve(base, values.dir ?? '.');
  const server = serverOrigin(selectedServer(values, options.env));
  const at = name => path.join(dir, name), project = {title, dir, at, server, options};
  if (kind !== 'api') return trackerApp(kind, values, project);
  for (const flag of ['preset', 'without', 'limit']) if (values[flag] !== undefined)
    throw invalid('not_for_api', `--${flag} is for the tracker: --kind api has no features.`,
      `Drop --${flag}, or drop --kind api.`);
  return ownRowsApp('api', {...project, url: apiUrl(values.url)});
}
await runTool('new-app', import.meta.url, newAppCommand);
