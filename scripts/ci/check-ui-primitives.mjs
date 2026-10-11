/**
 * THE APP'S ONE LOOK. Controls, overlays and surfaces in the Solid app are drawn by `services/app/solid/ui`
 * and nowhere else; every other module composes them. This guard fails a hand-rolled control, overlay or
 * one-off style outside that library, and an exported class-string constant for a control inside it.
 *
 * Two files record what is allowed, each by exact count per `path` + `rule`:
 *  - `ui-primitives-allowlist.json` is MIGRATION DEBT: a count may only fall (lower its entry when it does),
 *    and a new file or rule is refused.
 *  - `ui-primitives-exceptions.json` is PERMANENT and justified: colors that are data, not UI (a terminal's
 *    palette, a code editor's theme, a document's own ground). Each entry needs a `reason`, its count must match
 *    exactly (more or fewer is refused), and the same path + rule is never in both files.
 *
 * Scope: all of `services/app/solid`, plus the offline file's Solid chrome (`services/app/lib/offline/*.tsx`),
 * which draws the same bars and dialogs outside the app shell. The reader kit that draws DOCUMENT content
 * (`lib/islands/kit`, `lib/frame-edit`) is not app chrome and stays unscanned.
 *
 *   node scripts/ci/check-ui-primitives.mjs [--root <dir>] [--allowlist <file>] [--exceptions <file>] [--write-baseline]
 *
 * `--write-baseline` rewrites the allowlist from the tree (minus the documented exceptions); use it only when a
 * migration removed offenders.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(option('--root') ?? sourceRoot);
const allowlistPath = path.resolve(option('--allowlist') ?? path.join(sourceRoot, 'scripts/ci/ui-primitives-allowlist.json'));
const exceptionsPath = path.resolve(option('--exceptions') ?? path.join(sourceRoot, 'scripts/ci/ui-primitives-exceptions.json'));

const SCOPE = /^services\/app\/solid\/.+\.(tsx|css)$|^services\/app\/lib\/offline\/[^/]+\.tsx$/;
const EXEMPT = /^services\/app\/solid\/test\/|\/__tests__\//;
const IN_UI = /^services\/app\/solid\/ui\//;
const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** The rest of an opening tag: anything but `<` and `>`, except the `=>` of an arrow-function attribute. */
const IN_TAG = '(?:[^<>=]|=(?!>)|=>)*?';

/**
 * A CONTROL LOOK in one class string: a control's geometry token (its height or radius) with padding or a hover
 * fill, or any radius with a hover fill. Ordinary text links (`LINK`: colour and underline), list rows without a
 * radius and inline code chips without a hover all fall outside it.
 */
const CONTROL_TOKEN = /(?:^|[\s'"`:])(?:(?:min-)?[hw]|size)-control(?:-sm|-xs)?(?=[\s'"`]|$)|\brounded-control\b/;
const PADDING = /(?:^|[\s'"`:])p[xytrbl]?-(?:\d|\[)/;
const HOVER_FILL = /\bhover:(?:bg|border)-/;
const RADIUS = /(?:^|[\s'"`:])rounded(?:-(?:sm|md|lg|xl|chip|control))?(?=[\s'"`]|$)/;
const controlLook = (text) => (CONTROL_TOKEN.test(text) && (PADDING.test(text) || HOVER_FILL.test(text))) || (RADIUS.test(text) && HOVER_FILL.test(text));

/** Each rule names the primitive that replaces what it matches. `inUi` rules police solid/ui itself; the others police everything else. */
const RULES = [
  { id: 'native-select', use: 'ui/Select', pattern: /<select\b/g },
  // On an HTML element only: `<Dialog role="alertdialog">` is the primitive being used, not hand-rolled.
  { id: 'popup-role', use: 'ui/Menu, ui/Select, ui/Dialog, ui/Tabs or ui/Switch', pattern: new RegExp(`<[a-z][a-z0-9]*\\b${IN_TAG}\\srole=["'{]+(?:menu|listbox|dialog|alertdialog|tablist|switch)\\b`, 'g') },
  { id: 'overlay', use: 'ui/Dialog', pattern: /\bfixed inset-0\b/g },
  // A bare <details> draws the browser's own triangle in the browser's own type, whatever the page around it uses.
  { id: 'native-disclosure', use: 'ui/Disclosure', pattern: /<details\b/g },
  { id: 'native-title', use: 'ui/Tooltip', pattern: new RegExp(`<(?!iframe\\b)[a-z][a-z0-9]*\\b${IN_TAG}\\stitle=`, 'g') },
  { id: 'styled-button', use: 'ui/Button', pattern: new RegExp(`<button\\b${IN_TAG}\\sclass(?:List)?=`, 'g') },
  { id: 'styled-field', use: 'ui/Input, ui/Textarea, ui/SearchField or ui/Checkbox', pattern: new RegExp(`<(?:input|textarea)\\b${IN_TAG}\\sclass(?:List)?=`, 'g') },
  { id: 'arbitrary-radius', use: 'rounded-chip|control|panel|dialog', pattern: /\brounded(?:-[a-z]{1,2})?-\[/g },
  { id: 'arbitrary-text', use: 'text-micro, text-2xs or the Tailwind scale', pattern: /\btext-\[\d/g },
  { id: 'raw-color', use: 'a theme color token', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'palette-color', use: 'a theme color token', pattern: new RegExp(`\\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to)-(?:black|white|(?:${PALETTE})-\\d{2,3})\\b`, 'g') },
  // A link drawn as a control (a row, a chip, a bordered button) evades styled-button because it is an <a>, and a
  // module-level class constant (`ROW`, `MENU_ROW`) evades every tag rule because the tag only says `class={ROW}`.
  // Both are a hand-rolled Button: use `Button href` (which draws the same variants on an anchor).
  { id: 'link-control', use: 'ui/Button with href (or a Button variant)', when: controlLook,
    pattern: new RegExp(`<a\\s${IN_TAG}>|^(?:export )?const [A-Za-z_$][\\w$]* = (?:'[^'\\n]*'|"[^"\\n]*"|\`[^\`]*\`)`, 'gm') },
  // The control look tokens are ui-internal: a module outside ui that imports them is drawing a control by hand.
  { id: 'style-constant', use: 'the ui component that owns the style', pattern: /\bfrom\s+['"][^'"]*control-styles['"]/g },
  // ui exports components, not class strings: an exported FORM_INPUT-style constant invites the hand-rolled controls this guard exists to stop.
  // Only ui.tsx's page column and link styles are named here; the control tokens live in control-styles.ts, which is .ts and never exported past ui.
  { id: 'control-constant', use: 'a ui component (control look is not exported as a class string)', inUi: true, pattern: /^export const (?!(?:LINK|PAGE_COLUMN)\b)[A-Z][A-Z0-9_]* = ['"`]/gm },
];

/** Offender counts per `file\0rule` for one file's text. */
function scan(file, text) {
  const found = new Map();
  const inUi = IN_UI.test(file);
  for (const rule of RULES) {
    if (!!rule.inUi !== inUi) continue;
    const hits = [...text.matchAll(rule.pattern)].filter((match) => !rule.when || rule.when(match[0])).length;
    if (hits) found.set(`${file}\0${rule.id}`, hits);
  }
  return found;
}

const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', 'services/app/solid', 'services/app/lib/offline'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => SCOPE.test(file) && !EXEMPT.test(file))
  .sort();
const actual = new Map();
for (const file of files) {
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  for (const [key, count] of scan(file, text)) actual.set(key, count);
}

const readEntries = (file) => JSON.parse(readFileSync(file, 'utf8'));
const exceptions = readEntries(exceptionsPath);
const excepted = new Map(exceptions.map(({ path: file, rule, count }) => [`${file}\0${rule}`, count]));

if (args.includes('--write-baseline')) {
  const lines = [...actual].flatMap(([key, count]) => {
    const [file, rule] = key.split('\0');
    const debt = count - (excepted.get(key) ?? 0);
    return debt > 0 ? [`  ${JSON.stringify({ path: file, rule, count: debt })}`] : [];
  });
  writeFileSync(allowlistPath, lines.length ? `[\n${lines.join(',\n')}\n]\n` : '[]\n');
  console.log(`UI-primitive baseline written: ${lines.length} entries.`);
  process.exit(0);
}

const allowed = new Map(readEntries(allowlistPath).map(({ path: file, rule, count }) => [`${file}\0${rule}`, count]));
const violations = [];
const use = Object.fromEntries(RULES.map((rule) => [rule.id, rule.use]));
for (const { path: file, rule, reason } of exceptions) {
  if (typeof reason !== 'string' || !reason.trim()) violations.push(`${file}: exception for ${rule} needs a reason (why this is data, not UI)`);
  if (allowed.has(`${file}\0${rule}`)) violations.push(`${file}: ${rule} is in both the allowlist and the exceptions; a use is migration debt or a documented exception, not both`);
}
for (const [key, count] of actual) {
  const [file, rule] = key.split('\0');
  const limit = (allowed.get(key) ?? 0) + (excepted.get(key) ?? 0);
  if (count > limit) violations.push(`${file}: ${count - limit} new ${rule} (use ${use[rule]})`);
}
for (const [key, limit] of allowed) {
  const count = actual.get(key) ?? 0;
  const [file, rule] = key.split('\0');
  if (count < limit) violations.push(`${file}: ${rule} fell to ${count}; lower its allowlist entry from ${limit}${count ? '' : ' by deleting it'}`);
}
for (const [key, limit] of excepted) {
  const count = actual.get(key) ?? 0;
  const [file, rule] = key.split('\0');
  if (count < limit) violations.push(`${file}: ${rule} fell to ${count}; the documented exception says ${limit}, so update or delete that exception`);
}

if (violations.length) {
  console.error('UI-primitive guard: draw controls, overlays and styles with services/app/solid/ui (scripts/ci/ui-primitives-allowlist.json ratchets migration debt; scripts/ci/ui-primitives-exceptions.json documents permanent exceptions).');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`UI-primitive guard passed (${allowed.size} ratcheted entries, ${exceptions.length} documented exceptions).`);
