/**
 * The tracker starter is one marked template trimmed by features (examples/tracker*.*, scripts/toolbox-tracker.mjs):
 * every combination of its five features either generates files with no leftover marker, no dropped feature's code,
 * no name used but not defined and no syntax error, or is refused for a missing requirement (32 = 20 clean + 12
 * refused). A planted mistake (a feature's call left outside its block) fails exactly the combinations without that
 * feature, naming the identifier, so the check cannot pass vacuously.
 */
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {afterAll, expect, it} from 'vitest';
import {FEATURES, PRESETS, columns, rules} from '../../../skills/artifactbin/examples/tracker-features.mjs';
import {markers, trackerFeatures, trackerFiles, trim} from '../../../skills/artifactbin/scripts/toolbox-tracker.mjs';

const EXAMPLES = new URL('../../../skills/artifactbin/examples/', import.meta.url);
const NAMES = Object.keys(FEATURES);
const AMBIENT = `declare module '@afbin/apollo'{export const sql:any,onResolverChange:any}
declare module '@afbin/collab'{export const collab:any}
declare module '@afbin/data-table'{}
declare const page:any, step:any; interface Window{APP:any}`;
/** Diagnostics that mean trimming broke the code: syntax, a name used but not defined, a name defined twice. */
const BROKEN = new Set([2304, 2552, 2448, 2451, 2300]);

type Files = Record<string, string>;
const combos = () => Array.from({length: 1 << NAMES.length}, (_, mask) =>
  new Set(NAMES.filter((_, i) => mask & (1 << i))));
const label = (keep: Set<string>) => [...keep].join('+') || 'core';

/** One program over every combination's scripts: page modules, the config script, the steps bodies, the resolver. */
function brokenNames(sets: Array<[string, Files]>): Map<string, string[]> {
  const files = new Map<string, string>([['/v/ambient.d.ts', AMBIENT]]);
  for (const [name, out] of sets) {
    const scripts = [...out['index.html']!.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
    files.set(`/v/${name}/config.js`, scripts[0]!);
    files.set(`/v/${name}/page.js`, scripts[1]!);
    for (const steps of ['steps.mjs', 'guest.mjs', 'cleanup.mjs'])
      files.set(`/v/${name}/${steps.replace('.mjs', '.js')}`, `export async function run(){${out[steps]}\n}`);
    if (out['tracker.ts']) files.set(`/v/${name}/tracker.ts`, out['tracker.ts']);
  }
  const host = ts.createCompilerHost({}), base = {...host};
  host.getSourceFile = (f, v) => files.has(f) ? ts.createSourceFile(f, files.get(f)!, v, true) : base.getSourceFile(f, v);
  host.fileExists = f => files.has(f) || base.fileExists(f);
  host.readFile = f => files.get(f) ?? base.readFile(f);
  const program = ts.createProgram([...files.keys()], {allowJs: true, checkJs: true, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true, types: []}, host);
  const found = new Map<string, string[]>();
  for (const d of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
    if (!d.file || (d.category !== ts.DiagnosticCategory.Error) || (d.code >= 2000 && !BROKEN.has(d.code))) continue;
    const name = d.file.fileName.split('/')[2]!;
    found.set(name, [...found.get(name) ?? [], `${path.basename(d.file.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`]);
  }
  return found;
}
/** What is wrong with one combination's files beyond the compiler's view. */
function leftovers(keep: Set<string>, out: Files): string[] {
  const problems: string[] = [];
  for (const [file, text] of Object.entries(out)) {
    if (/@(?:feature|end|only)\s+!/.test(text)) problems.push(`${file}: a negated marker is left`);
    for (const name of NAMES) if (!keep.has(name) && new RegExp(`@(?:feature|only) ${name}\\b`).test(text))
      problems.push(`${file}: ${name} code is left`);
  }
  // tracker.ts is always there (me says who reads); only limits adds add, and only limits calls it.
  if (!/rel="af-resolver" data-af-name="tracker"/.test(out['index.html']!) || !('tracker.ts' in out)) problems.push('tracker.ts is not linked');
  if (keep.has('limits') !== /\badd\(input/.test(out['tracker.ts'] ?? '')) problems.push('tracker.ts add and limits disagree');
  if (keep.has('limits') !== /call\('add'/.test(out['index.html']!)) problems.push('the page\'s add and limits disagree');
  return problems;
}
async function generateAll(from = EXAMPLES) {
  const clean: Array<[string, Files]> = [], refused: string[] = [];
  for (const keep of combos()) {
    const without = NAMES.filter(name => !keep.has(name));
    try { trackerFeatures({without}); } catch (error) {
      expect(error, label(keep)).toMatchObject({code: 'feature_requires', exit: 2});
      refused.push(label(keep));
      continue;
    }
    clean.push([label(keep), await trackerFiles(keep, {}, from)]);
  }
  return {clean, refused};
}

const temps: string[] = [];
afterAll(() => Promise.all(temps.map(dir => rm(dir, {recursive: true, force: true}))));

it('generates every valid feature combination clean and refuses the 12 that miss a requirement', async () => {
  const {clean, refused} = await generateAll();
  expect(clean).toHaveLength(20);
  expect(refused).toHaveLength(12);
  // Every refusal names a feature whose requirement was dropped: team or limits without own-rows.
  expect(refused.every(name => !name.includes('own-rows') && /team|limits/.test(name))).toBe(true);
  for (const [name, out] of clean) expect(leftovers(new Set(name === 'core' ? [] : name.split('+')), out), name).toEqual([]);
  expect(Object.fromEntries(brokenNames(clean))).toEqual({});
}, 60_000);

it('fails exactly the combinations without a feature whose call was planted outside its lines', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-planted-'));temps.push(dir);
  await cp(EXAMPLES, dir, {recursive: true});
  const page = path.join(dir, 'tracker.html'), source = await readFile(page, 'utf8');
  // Two planted mistakes: the table's render call and the collab close lose their line markers.
  const planted = source.replace('renderTable(); // @only table', 'renderTable();')
    .replace('if(!editing)closeTyping(); // @only collab', 'if(!editing)closeTyping();');
  expect(planted).not.toBe(source);
  await writeFile(page, planted);
  const {clean} = await generateAll(pathToFileURL(dir + '/'));
  const broken = brokenNames(clean);
  const expected = clean.map(([name]) => name).filter(name => !name.includes('table') || !name.includes('collab'));
  expect([...broken.keys()].sort()).toEqual(expected.sort());
  for (const [name, problems] of broken) {
    if (!name.includes('table')) expect(problems.join('\n'), name).toMatch(/renderTable/);
    if (!name.includes('collab')) expect(problems.join('\n'), name).toMatch(/closeTyping/);
  }
}, 60_000);

it('refuses unknown features, presets and markers, and unbalanced blocks', () => {
  expect(() => trackerFeatures({without: ['kanban']})).toThrow(expect.objectContaining({code: 'unknown_feature', exit: 2}));
  expect(() => trackerFeatures({preset: 'kanban'})).toThrow(expect.objectContaining({code: 'invalid_preset'}));
  expect(() => trackerFeatures({without: ['own-rows']})).toThrow(expect.objectContaining({code: 'feature_requires',
    recovery: expect.stringContaining('--without own-rows,team')}));
  expect(() => markers('// @feature kanban\nx\n// @end kanban')).toThrow('unknown feature kanban');
  expect(() => markers('x // @only kanban')).toThrow('unknown feature kanban');
  expect(() => markers('// @feature table\nx')).toThrow('unclosed @feature table');
  expect(() => markers('// @feature table\n// @end collab')).toThrow('@end collab closes table');
});

it('keeps a kept feature\'s markers, drops a negated one\'s, and keeps a !feature line only when the feature is off', () => {
  const source = ['a', 'b // @only table', 'c // @only !table', '/* @feature collab */', 'd', '/* @end collab */'].join('\n');
  expect(trim(source, new Set(['table']))).toBe('a\nb // @only table');
  expect(trim(source, new Set(['collab']))).toBe('a\nc\n/* @feature collab */\nd\n/* @end collab */');
});

it('writes one --limit into the page and the resolver, the preset\'s texts, and the columns and rules each feature needs', async () => {
  const tasks = await trackerFiles(trackerFeatures({}), {limit: 12});
  expect(tasks['index.html']).toMatch(/^ {2}limit: 12,/m);
  expect(tasks['tracker.ts']).toMatch(/^const LIMIT=12;/m);
  const list = await trackerFiles(trackerFeatures({preset: 'list'}), {preset: 'list'});
  expect(Object.keys(list).sort()).toEqual(['cleanup.mjs', 'guest.mjs', 'index.html', 'steps.mjs', 'tracker.ts']);
  expect(list['tracker.ts']!.slice(list['tracker.ts']!.indexOf('*/'))).not.toMatch(/LIMIT|add|roles/);
  for (const [from, to] of Object.entries(PRESETS.list.texts)) {
    expect(list['index.html'], from).not.toContain(`'${from}'`);
    expect(list['index.html'], to).toContain(`'${to}'`);
  }
  expect(columns(new Set(PRESETS.tasks.features))).toEqual(['name', 'grp', 'note', 'created_by', 'description']);
  const own = {table: {schema: 'public', name: 'rows'}, select_permissions: [],
    update_permissions: ['viewer', 'signed_in'].map(role => ({role, permission: {columns: ['name'], filter: {created_by: {_eq: 'X-Hasura-User-Id'}}, check: {created_by: {_eq: 'X-Hasura-User-Id'}}}})),
    delete_permissions: ['viewer', 'signed_in'].map(role => ({role, permission: {filter: {created_by: {_eq: 'X-Hasura-User-Id'}}}}))};
  const team = rules(own, new Set(['own-rows', 'team', 'collab']));
  expect(team.update_permissions.map((e: any) => [e.role, e.permission.filter])).toEqual([['viewer', {}], ['signed_in', {created_by: {_eq: 'X-Hasura-User-Id'}}]]);
  expect(team.delete_permissions[0].permission).toEqual({filter: {}});
  expect(team.collaborative_columns).toEqual(['description']);
  expect(rules(own, new Set(['own-rows']))).toEqual(own);
  expect(Object.keys(rules(own, new Set()))).toEqual(['table', 'select_permissions']);
});
