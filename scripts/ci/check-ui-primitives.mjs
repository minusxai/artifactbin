/**
 * THE APP'S ONE LOOK. Controls, overlays and surfaces in the Solid app are drawn by `services/app/solid/ui`
 * and nowhere else; every other module composes them. This guard fails a hand-rolled control, overlay or
 * one-off style outside that library. Existing offenders are listed in `ui-primitives-allowlist.json` with
 * their exact counts: a count may only fall (lower its entry when it does), and a new file or rule is refused.
 *
 *   node scripts/ci/check-ui-primitives.mjs [--root <dir>] [--allowlist <file>] [--write-baseline]
 *
 * `--write-baseline` rewrites the allowlist from the tree; use it only when a migration removed offenders.
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

const SCOPE = /^services\/app\/solid\/.+\.(tsx|css)$/;
const EXEMPT = /^services\/app\/solid\/(ui|test)\/|\/__tests__\//;
const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** The rest of an opening tag: anything but `<` and `>`, except the `=>` of an arrow-function attribute. */
const IN_TAG = '(?:[^<>=]|=(?!>)|=>)*?';

/** Each rule names the primitive that replaces what it matches. */
const RULES = [
  { id: 'native-select', use: 'ui/Select', pattern: /<select\b/g },
  // On an HTML element only: `<Dialog role="alertdialog">` is the primitive being used, not hand-rolled.
  { id: 'popup-role', use: 'ui/Menu, ui/Select, ui/Dialog, ui/Tabs or ui/Switch', pattern: new RegExp(`<[a-z][a-z0-9]*\\b${IN_TAG}\\srole=["'{]+(?:menu|listbox|dialog|alertdialog|tablist|switch)\\b`, 'g') },
  { id: 'overlay', use: 'ui/Dialog', pattern: /\bfixed inset-0\b/g },
  { id: 'native-title', use: 'ui/Tooltip', pattern: new RegExp(`<[a-z][a-z0-9]*\\b${IN_TAG}\\stitle=`, 'g') },
  { id: 'styled-button', use: 'ui/Button', pattern: new RegExp(`<button\\b${IN_TAG}\\sclass(?:List)?=`, 'g') },
  { id: 'styled-field', use: 'ui/Input, ui/Textarea, ui/SearchField or ui/Checkbox', pattern: new RegExp(`<(?:input|textarea)\\b${IN_TAG}\\sclass(?:List)?=`, 'g') },
  { id: 'arbitrary-radius', use: 'rounded-chip|control|panel|dialog', pattern: /\brounded(?:-[a-z]{1,2})?-\[/g },
  { id: 'arbitrary-text', use: 'text-micro, text-2xs or the Tailwind scale', pattern: /\btext-\[\d/g },
  { id: 'raw-color', use: 'a theme color token', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'palette-color', use: 'a theme color token', pattern: new RegExp(`\\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to)-(?:black|white|(?:${PALETTE})-\\d{2,3})\\b`, 'g') },
  { id: 'style-constant', use: 'the ui component that owns the style', pattern: /\b(?:FORM_(?:INPUT|PRIMARY_BUTTON|SECONDARY_BUTTON|DANGER_BUTTON)|PANEL|TABLE_ROW)\b/g },
];

/** Offender counts per `file\0rule` for one file's text. */
function scan(file, text) {
  const found = new Map();
  for (const rule of RULES) {
    const hits = text.match(rule.pattern)?.length ?? 0;
    if (hits) found.set(`${file}\0${rule.id}`, hits);
  }
  return found;
}

const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', 'services/app/solid'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => SCOPE.test(file) && !EXEMPT.test(file))
  .sort();
const actual = new Map();
for (const file of files) {
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  for (const [key, count] of scan(file, text)) actual.set(key, count);
}

if (args.includes('--write-baseline')) {
  const lines = [...actual].map(([key, count]) => {
    const [file, rule] = key.split('\0');
    return `  ${JSON.stringify({ path: file, rule, count })}`;
  });
  writeFileSync(allowlistPath, lines.length ? `[\n${lines.join(',\n')}\n]\n` : '[]\n');
  console.log(`UI-primitive baseline written: ${lines.length} entries.`);
  process.exit(0);
}

const allowed = new Map(JSON.parse(readFileSync(allowlistPath, 'utf8')).map(({ path: file, rule, count }) => [`${file}\0${rule}`, count]));
const violations = [];
const use = Object.fromEntries(RULES.map((rule) => [rule.id, rule.use]));
for (const [key, count] of actual) {
  const [file, rule] = key.split('\0');
  const limit = allowed.get(key) ?? 0;
  if (count > limit) violations.push(`${file}: ${count - limit} new ${rule} (use ${use[rule]})`);
}
for (const [key, limit] of allowed) {
  const count = actual.get(key) ?? 0;
  const [file, rule] = key.split('\0');
  if (count < limit) violations.push(`${file}: ${rule} fell to ${count}; lower its allowlist entry from ${limit}${count ? '' : ' by deleting it'}`);
}

if (violations.length) {
  console.error('UI-primitive guard: draw controls, overlays and styles with services/app/solid/ui (scripts/ci/ui-primitives-allowlist.json ratchets existing offenders).');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`UI-primitive guard passed (${allowed.size} ratcheted entries).`);
