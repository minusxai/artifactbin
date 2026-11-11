/** Command: a shared tracker (examples/tracker.html, trimmed), in one call. */
export const DESCRIPTION = `Set up a shared-app starter in one call: files, dataset, rules and id.
--kind tracker (default) writes examples/tracker.html as index.html with only the chosen
  features, plus steps.mjs, guest.mjs and cleanup.mjs (its checks); publishes an empty entries
  dataset (name, grp, note, created_by; description with collab) with the rules the features
  need, and fills its ref: id and title into index.html. --kind list is the tracker's list preset.
Tracker features: own-rows (signed-in people add entries and change or remove only their own);
  team (needs own-rows: a group the page is shared with by groups.mjs share PAGE --group GROUP
  --datasets changes every entry; a page share alone lets members change only theirs); collab
  (an entry's description is typed in together); table (a sortable table view).
Usage: node scripts/new-app.mjs --title NAME [--kind tracker|list] [--preset tasks|list]
  [--without FEATURE,…] [--dir DIR]
Flags: --title NAME the app's name, for <title> (a bare title argument works too);
  --preset tasks (default: every feature, a team task tracker) or list (own-rows only: a sign-up
  sheet, RSVP or roster); --kind list is --preset list; --without FEATURE,… drops features;
  --dir DIR the project directory (default: the current one; created when missing). Common:
  --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/new-app.mjs --title "Launch tasks"
  node scripts/new-app.mjs --kind list --title "Riverside cleanup volunteers"
  node scripts/new-app.mjs --title "Bug triage" --without collab
  node scripts/new-app.mjs --title "Workshop seats" --without team,collab,table
Gotchas: an unknown feature, or one whose requirement you drop, is refused (exit 2) with the fix.
  A rerun is safe: an existing file is kept (and listed as kept), never overwritten, and the
  dataset the kept index.html links (its ref:) is reused, so nothing is created twice. The steps,
  guest and cleanup files need no reading or editing. Who may do what lives in the dataset's
  rules (node scripts/policy.mjs explain ID), and only there: the page shows its controls to a
  signed-in reader and reports a write the rules refuse. Rules decide who may write which rows;
  they cannot cap how many rows a group holds.
Exit: 0 ok; 1 failed; 2 invalid (the one next step is printed); 3 auth/access (sign in, then
  rerun); 5 unknown write outcome (the error names the journal for publish.mjs --resume).
  Results never contain credentials.`;

import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runTool,ToolError,makeClient,selectedServer,serverOrigin} from './toolbox-client.mjs';
import {EXAMPLES,check,resolve,create,dataset,fill} from './toolbox-new-app.mjs';
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
/** The preset and kept features --kind, --preset and --without name. */
function choose(values, kind) {
  if (kind === 'list' && values.preset !== undefined && values.preset !== 'list')
    throw invalid('preset_conflict', '--kind list is the list preset.',
      `Drop --kind list to use --preset ${values.preset}.`);
  const preset = kind === 'list' ? 'list' : values.preset ?? 'tasks';
  const without = String(values.without ?? '').split(',').map(name => name.trim())
    .filter(Boolean);
  return {preset, keep: trackerFeatures({preset, without})};
}
/** The tracker: the template trimmed to its features, the entries dataset and its rules. */
async function trackerApp(kind, values, {title, dir, at, server, options}) {
  const {preset, keep} = choose(values, kind), created = [], kept = [];
  const files = await trackerFiles(keep, {preset});
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
    .map(name => FEATURES[name].summary);
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
    rules: rulesText, note,
    next: `Next: in index.html edit only APP: its [bracketed] text and groups (${groups}); ` +
      `then ${await check(at('index.html'))}` + (keep.has('team') ? '; for a team to edit ' +
      'every entry: node scripts/groups.mjs share PAGE --group GROUP --datasets' : '')};
}
export async function newAppCommand({values, positionals}, options = {}) {
  const title = String(values.title ?? positionals.join(' ')).trim()
    .replace(/^\[(.*)\]$/, '$1').trim();
  if (!title) throw invalid('missing_title', 'The app needs a name.', 'Run ' + USAGE);
  const kind = values.kind ?? 'tracker';
  if (!['tracker', 'list'].includes(kind)) throw invalid('invalid_kind',
    `--kind ${kind} is not a starter.`, 'Use --kind tracker or --kind list.');
  const base = options.cwd ?? process.cwd(), dir = resolve(base, values.dir ?? '.');
  const server = serverOrigin(selectedServer(values, options.env));
  const at = name => path.join(dir, name), project = {title, dir, at, server, options};
  return trackerApp(kind, values, project);
}
await runTool('new-app', import.meta.url, newAppCommand);
