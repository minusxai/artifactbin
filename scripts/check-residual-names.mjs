import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(option('--root') ?? sourceRoot);
const allowlistPath = path.resolve(option('--allowlist') ?? path.join(sourceRoot, 'scripts/residual-name-allowlist.json'));
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
const allowed = new Map(allowlist.map(({ path: file, value, count }) => [`${file}\0${value}`, count]));
const seenAllowed = new Map();
const ignoredFiles = new Set(['scripts/check-residual-names.mjs', 'scripts/residual-name-allowlist.json']);
const residual = /(?:artifact|artefact)(?:-|[ _])bin|artifactsbin/gi;

const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const violations = [];

for (const file of tracked) {
  if (ignoredFiles.has(file)) continue;
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  for (const match of text.matchAll(residual)) {
    // This exact spelling is the intentionally retained database/schema name.
    // Case and spelling variants remain product-identity violations.
    if (match[0] === 'artifact_bin') continue;
    const key = `${file}\0${match[0]}`;
    const line = text.slice(0, match.index).split('\n').length;
    if (!allowed.has(key)) {
      violations.push(`${file}:${line}: ${match[0]}`);
      continue;
    }
    const count = (seenAllowed.get(key) ?? 0) + 1;
    seenAllowed.set(key, count);
    if (count > allowed.get(key)) violations.push(`${file}:${line}: unexpected extra ${match[0]}`);
  }
}

for (const [key, expected] of allowed) {
  const actual = seenAllowed.get(key) ?? 0;
  if (actual !== expected) {
    const [file, value] = key.split('\0');
    violations.push(`${file}: expected ${expected} allowed occurrence(s) of ${value}, found ${actual}`);
  }
}

if (violations.length) {
  console.error('Residual pre-rename identities found outside the exact persistence/history allowlist:');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`Residual-name guard passed (${allowlist.length} exact persistence/history rules).`);
