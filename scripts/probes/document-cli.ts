// Executable planning surface: markup only; production grammar remains to implement.
import fs from 'node:fs';
import { parseJsx } from '../../services/app/lib/jsx/parse';
import { validateJsx } from '../../services/app/lib/jsx/validate';
const argv = process.argv.slice(2), command = argv.shift();
const positional = argv.filter(a => !a.startsWith('--'));
const dbPath = '.artifactbin/lock.json';
const lock: Record<string, { id: string; edit_id: string; version: number; source: string; pending?: boolean }> = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : {};
const help = `afbin <command> [arguments] [--json]
validate [path ...]  Validate JSX offline, read-only; does not publish.
status [--remote]    Local changed/clean summary. --remote checks current server head.
diff [path] [--remote] Local content versus saved state. --remote compares current server head without changing files.
push [path ...]      Create explicit new files; update changed tracked files. No paths = tracked files.
pull <ref> [path]    Download head or ref@version. Ref = id or tracked path. Dirty destination refuses unless --force.
log <ref>           List versions. Restore report.jsx with: pull report.jsx@1 then push report.jsx.
Each artifact has exactly one tracked path. Pulling a second copy while its tracked file exists is refused.
Inspect remote conflicts by backing up the local file and pulling that SAME path with --force.
-h, --help          This help; no network or authentication.
--json              One JSON result on stdout; errors include code and recovery.
Existing local paths win over @version syntax. Use id@version and explicit destination if shadowed.
doc_changed: copy dirty file to an unused backup path; pull --force to refresh content and sync state;
merge each change against the saved base and current head; validate and push. Never push --force.
Example: base owner Alice/budget 10, ours Alice/20, head Bob/10 -> merged Bob/20.
Do not concatenate contradictory copies. If the SAME field has conflicting edits, report it instead of guessing.
Use a unique backup in this workspace (mktemp ./conflict-backup.XXXXXX), not a fixed /tmp name.
Historical pull marks a pending restoration even when diff is empty; push it once, then check the returned version.
This planning executable supports markup workflows only. It has no MCP or remote skill loader.`;
function save() { fs.mkdirSync('.artifactbin', { recursive: true }); fs.writeFileSync(dbPath, JSON.stringify(lock, null, 2)); }
function emit(value: unknown) { console.log(JSON.stringify(value)); }
function check(source: string) { const parsed = parseJsx(source); if (!parsed.ok) throw { code: 'invalid_jsx', details: parsed, fix: 'Repair JSX syntax, run afbin validate <path>, then push.' }; const errors = validateJsx(parsed.nodes, { components: ['Helmet', 'Card'], stylePolicy: 'no-inline-style' }); if (errors.length) throw { code: 'invalid_jsx', errors, fix: 'Use plain HTML tags and className instead of inline style; validate again before push.' }; }
async function api(path: string, method = 'GET', body?: unknown) {
 fs.mkdirSync('.artifactbin', { recursive: true }); fs.appendFileSync('.artifactbin/requests.jsonl', JSON.stringify({ path, method }) + '\n');
 const r = await fetch(process.env.ARTIFACTBIN_URL + path, { method, headers: { authorization: 'Bearer ' + process.env.ARTIFACTBIN_TOKEN, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
 const d = await r.json(); if (!r.ok) throw { code: d.error || 'http_error', status: r.status, details: d, fix: r.status === 409 ? 'Preserve your dirty file in an unused backup; afbin pull <path> --force; manually merge saved changes into the fresh head, validate, then push. Do not discard either writer.' : 'Use afbin --help; repair the reported input before retrying.' }; return d;
}
function ref(raw: string) { const m = !fs.existsSync(raw) && raw.match(/^(.*)@(\d+)$/); const name = m ? m[1] : raw; if (fs.existsSync(name) && !lock[name]) throw { code: 'untracked_file', fix: 'Publish this new file with afbin push <path> first. Remote history does not exist yet.' }; return { name, id: lock[name]?.id || name, version: m ? Number(m[2]) : undefined }; }
try {
 const supported: Record<string,string[]> = {validate:[],status:['--remote'],diff:['--remote'],push:[],pull:['--force'],log:[]};
 if (command && supported[command] && !argv.some(a=>a==='--help'||a==='-h')) for(const flag of argv.filter(a=>a.startsWith('-'))) if(flag!=='--json'&&!supported[command].includes(flag)) throw {code:'unknown_option',option:flag,fix:flag==='--remote'?'--remote belongs to afbin status and afbin diff. Pull already fetches the selected remote version.':'Run afbin --help for flags supported by this command.'};
 if (!command || command === '-h' || command === '--help' || argv.includes('--help') || argv.includes('-h')) { console.log(help); }
 else if (command === 'validate') { for (const p of positional.length ? positional : Object.keys(lock)) check(fs.readFileSync(p, 'utf8')); emit({ ok: true, network: false }); }
 else if (command === 'status') { const rows = []; for (const [p, v] of Object.entries(lock)) rows.push({ path: p, changed: !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== v.source || !!v.pending, ...(argv.includes('--remote') ? { remoteChanged: (await api('/api/artifacts/' + v.id)).edit_id !== v.edit_id } : {}) }); emit(rows); }
 else if (command === 'diff') { const rows=[]; for (const p of positional.length ? positional : Object.keys(lock)) rows.push({path:p,before:argv.includes('--remote') ? (await api('/api/artifacts/'+ref(p).id)).markup : lock[p]?.source,after:fs.readFileSync(p,'utf8')}); emit(rows); }
 else if (command === 'push') { const results = []; for (const p of positional.length ? positional : Object.keys(lock)) { const source = fs.readFileSync(p, 'utf8'); check(source); const old = lock[p]; if (old && old.source === source && !old.pending) { results.push({ path: p, unchanged: true }); continue; } const d = old ? await api('/api/artifacts/' + old.id + (old.pending ? '' : '/edits'), old.pending ? 'PUT' : 'POST', old.pending ? { markup: source, expectedVersion: old.version } : { source, edit_id: old.edit_id }) : await api('/api/artifacts', 'POST', { markup: source, title: p }); const canonical = d.markup ?? (d.markup_changed === false ? source : undefined); if (canonical === undefined) throw {code:'incomplete_response',fix:'Preserve local state and recover this committed operation before retrying.'}; fs.writeFileSync(p, canonical); lock[p] = { id: d.id, edit_id: d.edit_id, version: d.version, source: canonical }; save(); results.push({ path: p, id: d.id, version: d.version }); } emit(results); }
 else if (command === 'pull') { const r = ref(positional[0]); const p = positional[1] || r.name; const duplicate = Object.entries(lock).find(([path, value]) => value.id === r.id && path !== p && fs.existsSync(path)); if (duplicate) throw { code: 'duplicate_identity', fix: 'This artifact is already tracked as ' + duplicate[0] + '. Use that path; back it up before pull --force. For history use afbin pull ' + duplicate[0] + '@<version> then push the same path.' }; if (fs.existsSync(p) && (!lock[p] || fs.readFileSync(p, 'utf8') !== lock[p].source) && !argv.includes('--force')) throw { code: 'local_changes', fix: 'Back up local changes before using pull --force.' }; const head = await api('/api/artifacts/' + r.id); const d = r.version === undefined ? head : await api('/api/artifacts/' + r.id + '/versions/' + r.version); fs.writeFileSync(p, d.markup); lock[p] = { id: head.id, edit_id: head.edit_id, version: head.version, source: d.markup, pending: r.version !== undefined }; save(); emit({ path: p, version: d.version, pending: r.version !== undefined }); }
 else if (command === 'log') { emit(await api('/api/artifacts/' + ref(positional[0]).id + '/versions')); }
 else throw { code: 'unknown_command', fix: 'Run afbin --help; use pull then push to restore.' };
} catch (error) { emit({ ok: false, ...(error instanceof Error ? { code: 'local_error', message: error.message } : error as object) }); process.exitCode = 1; }
