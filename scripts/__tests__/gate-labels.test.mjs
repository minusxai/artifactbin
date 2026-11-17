/**
 * A browser gate only looks for a name or text the app (or the gate's own fixture) still renders.
 *
 * #1175 moved the folder trail from the folder page into the page bar and dropped `aria-label="Folder trail"`.
 * Its unit test followed; two gates did not, and main went red after merge with a 30-second locator timeout.
 * Every literal a gate locates by is checked here, in pr fast: accessible names (`[aria-label="…"]`, `getByLabel`,
 * `getByRole(…, { name })`), text (`getByText`, `hasText`, `text=…`, `:has-text(…)`), placeholders, titles, alt text
 * and test ids. Each must appear in the app's source, start with a template or concatenation prefix the source builds
 * names from (`Open folder ${title}`, 'Name ' + key), or be authored by the gates' own scripts and fixtures (outside a
 * locator). The gates are the manifest's (scripts/gates.manifest.mjs) and every module they import
 * (scripts/lib/gate-pages.mjs `gateModules`).
 * Assertions that a name is ABSENT (`toHaveCount(0)`, `count() === 0`) are exempt: a retired name is their point.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gateModules } from '../lib/gate-pages.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '__tests__', '.vite']);
/** Build output (git-ignored): bundles of the source already read, and third-party libraries. */
const BUILT = new Set(['services/app/public/libraries', 'services/app/lib/build-assets'].map((dir) => path.join(ROOT, dir)));

function files(dir, pattern, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (BUILT.has(full)) continue;
    if (entry.isDirectory()) files(full, pattern, out);
    else if (pattern.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) out.push(full);
  }
  return out;
}
const read = (list) => list.map((file) => readFileSync(file, 'utf8')).join('\n');

/** A quoted literal with no template or escape in it: group `q` is the text. */
const LITERAL = String.raw`(?:'(?<q>[^'$\`{}\\\n]+)'|"(?<qq>[^"$\`{}\\\n]+)")`;
/** What a gate locates by, each kind with the literal it names. */
const SELECTORS = Object.freeze([
  ['aria-label', String.raw`\[aria-label[\^*$]?=` + LITERAL],
  ['label', String.raw`getByLabel\(\s*` + LITERAL],
  ['role name', String.raw`getByRole\(\s*['"][a-z]+['"]\s*,\s*\{[^}]*?\bname:\s*` + LITERAL],
  ['text', String.raw`getByText\(\s*` + LITERAL],
  ['text', String.raw`\bhasText:\s*` + LITERAL],
  ['text', String.raw`:has-text\(\s*` + LITERAL],
  ['text', String.raw`['"\`]text=(?<t>[^'"\`$\n]+)['"\`]`],
  ['placeholder', String.raw`getByPlaceholder\(\s*` + LITERAL],
  ['title', String.raw`getByTitle\(\s*` + LITERAL],
  ['alt text', String.raw`getByAltText\(\s*` + LITERAL],
  ['test id', String.raw`getByTestId\(\s*` + LITERAL],
  ['test id', String.raw`\[data-testid=` + LITERAL + String.raw`\]`],
].map(([kind, source]) => ({ kind, re: new RegExp(source, 'g') })));
/**
 * Names composed at run time from data (a column and a row, a role and a verb, a condition's path), which no literal
 * in any source holds. Each names the fragment that composes it; the fragment must still be in that file, so a
 * composition the app drops or renames fails here instead of passing every name it once built.
 */
const COMPOSED = Object.freeze([
  { pattern: /^\w+ files$/, file: 'services/app/lib/html-components/file-upload.ts', fragment: "setAttribute('aria-label', `${label} files`)" },
  { pattern: /^(?:Shared viewers|Signed-in link holders|Signed-out link holders): (?:see|add|change|delete)$/, file: 'services/app/solid/datasets/DatasetPolicies.tsx', fragment: 'ariaLabel={`${ROLE_LABEL[role]}: ${VERB[op]}`}' },
  { pattern: /^(?:insert|update) check(?:\.\d+)+ operator$/, file: 'services/app/solid/datasets/PolicyConditions.tsx', fragment: 'ariaLabel={`${label()} operator`}' },
  { pattern: /^(?:insert|update) check(?:\.\d+)+ value$/, file: 'services/app/solid/datasets/PolicyConditions.tsx', fragment: 'aria-label={`${label()} value`}' },
  { pattern: /^(?:item|hours|done|tags) \d+$/, file: 'scripts/gates/lib/native-editable-dataset-page.mjs', fragment: "aria-label',column.name+' '+label)" },
]);
const ABSENT = /toHaveCount\(0\)|count\(\)\)? ?=== ?0|\.toBeNull\(\)/;
const named = (match) => match.groups.q ?? match.groups.qq ?? match.groups.t;

const modules = gateModules(ROOT).filter((module) => module.file.startsWith(path.join(ROOT, 'scripts') + path.sep));
const gateSources = modules.map((module) => module.file);
const appSource = read(files(path.join(ROOT, 'services'), /\.(tsx?|mjs|js|html)$/));
const scriptSource = gateSources.map((file) => readFileSync(file, 'utf8')).join('\n');
// A name built at runtime: `Open folder ${title}` or 'Name ' + key.
const templateHeads = new Set([...`${appSource}\n${scriptSource}`.matchAll(/`([A-Za-z][^`$\n]{2,})\$\{|'([A-Za-z][^'\n]{2,})' ?\+/g)]
  .map((m) => m[1] ?? m[2]));
const builtFromHead = (label) => { for (let end = 3; end <= label.length; end += 1) if (templateHeads.has(label.slice(0, end))) return true; return false; };
/** Calls whose string arguments locate (a selector, a name) or report (a check's message), never author. */
const LOCATES = /^(?:getBy[A-Z]\w*|locator|filter|frameLocator|waitForSelector|\$\$?|\$\$?eval|querySelector(?:All)?|closest|matches)$/;
const REPORTS = /^(?:check|must|step|section|lane|ok|equal|strictEqual|deepEqual|notEqual|match|fail|log|error|warn|info|Error|TypeError|RangeError)$/;
/**
 * What the gates' scripts author: the text of every string they hold (a fixture's own page, a dataset row, a button a
 * page script draws), less the strings that only locate or report and less comments, which a parser never sees.
 */
const authoredByScripts = modules.flatMap((module) => module.nodes.flatMap((node) => {
  const text = node.type === 'Literal' && typeof node.value === 'string' ? node.value
    : node.type === 'TemplateElement' ? node.value.cooked ?? node.value.raw : null;
  if (text === null) return [];
  for (let at = node.parent; at; at = at.parent) {
    if (at.type !== 'CallExpression' && at.type !== 'NewExpression') continue;
    const callee = at.callee.type === 'MemberExpression' ? at.callee.property.name : at.callee.name;
    if (LOCATES.test(callee ?? '') || REPORTS.test(callee ?? '')) return [];
    break;
  }
  return [text];
})).join('\n');
const rendered = (label) => appSource.includes(label)
  || (/[&']/.test(label) && [label.replaceAll('&', '&amp;'), label.replaceAll("'", '&#39;'), label.replaceAll("'", '’')].some((form) => appSource.includes(form)));

/** Every literal the gates locate by: { kind, label, gate }. */
function wantedNames(sources = gateSources) {
  const wanted = [];
  for (const file of sources) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (ABSENT.test(line)) continue;
      for (const { kind, re } of SELECTORS) for (const m of line.matchAll(re)) wanted.push({ kind, label: named(m), gate: path.relative(ROOT, file) });
    }
  }
  return wanted;
}
const known = new Map();
const fromApp = (label) => { if (!known.has(label)) known.set(label, rendered(label) || builtFromHead(label)); return known.get(label); };

describe('browser gate locators', () => {
  it('reads every literal name and text from the gates and the modules they run', () => {
    const wanted = wantedNames();
    expect(gateSources.length).toBeGreaterThan(40);
    expect(wanted.length).toBeGreaterThan(300);
    // Not vacuous: the text and role-name locators resolve against the app's own source, not only the fixtures'.
    const resolved = (kind) => wanted.filter((name) => name.kind === kind && fromApp(name.label)).length;
    expect(resolved('role name')).toBeGreaterThan(100);
    expect(resolved('text')).toBeGreaterThan(15);
    expect(resolved('aria-label')).toBeGreaterThan(20);
  });

  it('only looks for names and text the app or its own fixture renders', () => {
    const composed = (label) => COMPOSED.some(({ pattern }) => pattern.test(label));
    const missing = wantedNames().filter(({ label }) => !fromApp(label) && !authoredByScripts.includes(label) && !composed(label));
    expect([...new Set(missing.map(({ kind, label, gate }) => `${gate}: ${kind} "${label}"`))]).toEqual([]);
  });

  it('still composes every name it lets a gate locate by pattern', () => {
    expect(COMPOSED.filter(({ file, fragment }) => !readFileSync(path.join(ROOT, file), 'utf8').includes(fragment)).map(({ file }) => file)).toEqual([]);
    expect(COMPOSED.filter(({ pattern }) => pattern.test('Folder trail'))).toEqual([]);
  });

  it('would have caught the retired folder trail', () => {
    expect(fromApp('Folder trail')).toBe(false);
    expect(authoredByScripts.includes('Folder trail')).toBe(false);
    // #1175's two gates, as they located it: each form of locator is read.
    for (const line of ['page.locator(\'[aria-label="Folder trail"] a\')', "page.getByRole('navigation', { name: 'Folder trail' })", "frame.getByText('Folder trail')", 'locator(\'nav:has-text("Folder trail")\')']) {
      expect(SELECTORS.flatMap(({ re }) => [...line.matchAll(re)].map(named))).toEqual(['Folder trail']);
    }
  });
});
