#!/usr/bin/env node
/**
 * MIGRATE A DOCUMENT'S SCRIPT TO THE SOLID CONTRACT. The rewrite itself is
 * services/app/lib/author-script/migrate-scripts.ts (its header lists every rule); this is its command line.
 *
 *   node scripts/migrate-scripts.mjs [--write] [--print] <file.jsx | directory> ...
 *
 * Reads each `.jsx` document (a directory: every `.jsx` in it, recursively; an `afbin` front matter block is kept as
 * it is) and reports, per file, whether it is already on the Solid contract, what was rewritten, and what is left
 * for a person (each marked `MIGRATE:` in the document). `--write` saves the migrated documents in place;
 * `--print` writes each migrated document to stdout (the report then goes to stderr). Without either it changes nothing. A second run over migrated
 * output reports every file unchanged. Exit status 1 when anything was left for a person, else 0.
 *
 * How many stored documents a deployment has to migrate (an upper bound: the `page` clause cannot tell an old
 * import from a new one that binds nothing), on its Postgres database:
 *
 *   SELECT count(*) FROM artifacts WHERE format = 'markup' AND deleted_at IS NULL AND (coalesce(source, document::text) LIKE '%<Iframe%' OR coalesce(source, document::text) ~ '\mmx\.(read|set|subscribe|mutate|describe)\(' OR coalesce(source, document::text) LIKE '%@preact/signals%' OR (coalesce(source, document::text) ~ 'from\s*[''"]page[''"]' AND coalesce(source, document::text) !~ '\m(signal|query|mutation)\(\s*[''"]\$'));
 *
 * Runs under plain `node`; the TypeScript module is loaded through tsx's `tsImport`, as scripts/render-schema.mjs does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';

const args = process.argv.slice(2);
const write = args.includes('--write');
const print = args.includes('--print');
// Targets are taken relative to where the command was run; the module's `@/lib` paths resolve from the repository root.
const targets = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(a));
process.chdir(path.resolve(import.meta.dirname, '..'));
if (!targets.length) {
  console.error('usage: node scripts/migrate-scripts.mjs [--write] [--print] <file.jsx | directory> ...');
  process.exit(2);
}

const { migrateDocumentScripts } = await tsImport('../services/app/lib/author-script/migrate-scripts.ts', import.meta.url);

const files = [];
const collect = (target) => {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) for (const entry of fs.readdirSync(target).sort()) collect(path.join(target, entry));
  else if (target.endsWith('.jsx')) files.push(target);
};
for (const target of targets) collect(target);

/** An afbin-tracked file starts with a `---` front matter block: kept as it is, the rest migrated. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;

/** With --print the documents own stdout, so the report goes to stderr. */
const report = print ? (line) => console.error(line) : (line) => console.log(line);
let left = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const front = FRONT_MATTER.exec(text)?.[0] ?? '';
  const result = migrateDocumentScripts(text.slice(front.length));
  const status = result.changed ? 'migrated' : result.unresolved.length ? 'needs a person' : 'unchanged';
  report(`${file}: ${status}`);
  for (const rule of result.applied) report(`  rewrote: ${rule}`);
  for (const note of result.unresolved) report(`  MIGRATE: ${note}`);
  if (result.unresolved.length) left++;
  if (result.changed && write) fs.writeFileSync(file, front + result.source);
  if (print) process.stdout.write(`${front}${result.source}`);
}
report(`${files.length} file(s), ${left} with something left for a person${write ? '' : ' (dry run: nothing written)'}.`);
process.exit(left ? 1 : 0);
