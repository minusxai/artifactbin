/** Build boundary shared by source consumers, including cache-restored checkouts.
 *
 * The generator costs ~3 s (tsx compiles the CLI registries and the skill tree), so the routine
 * checks call it through a content-verified cache: the marker records every repository file the
 * compiler's import graph reaches (esbuild metafile; node_modules excluded, workspace packages such as
 * services/contracts followed through their symlink), every file under services/app/skills (read by
 * fs, not imported), the tools, and the output's hash. A size+mtime match short-circuits a file's
 * content hash; anything else re-hashes. Any error in the check means "generate", never "skip".
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GENERATOR = 'services/cli/scripts/generate-teaching.mjs';
const ENTRY = 'services/cli/scripts/compile-teaching.ts';
const OUTPUT = 'services/cli/src/generated/teaching.json';
const SKILLS = 'services/app/skills';
const TOOLS = [GENERATOR, 'scripts/lib/generate-teaching.mjs', 'scripts/register-yaml.cjs', 'package-lock.json', 'services/cli/package.json'];
const MARKER = path.join(ROOT, 'node_modules/.cache/teaching.json');
const VERSION = 1;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const posix = (file) => file.split(path.sep).join('/');
const listSkills = (dir = SKILLS) => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? listSkills(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]).sort();

function stamp(file) {
  const stat = statSync(path.join(ROOT, file));
  return [stat.size, stat.mtimeMs, sha(readFileSync(path.join(ROOT, file)))];
}

/** Repository files the compiler imports, following workspace symlinks out of node_modules. */
async function graphInputs() {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, ENTRY)], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm',
    logLevel: 'silent', loader: { '.yaml': 'text', '.md': 'text' },
    plugins: [{
      name: 'external-dependencies',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (args.pluginData?.inner) return undefined;
          const resolved = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { inner: true } });
          if (resolved.errors.length || !resolved.path || resolved.path.split(path.sep).includes('node_modules')) return { path: args.path, external: true };
          return resolved;
        });
      },
    }],
  });
  return Object.keys(result.metafile.inputs)
    .filter((file) => !/^[\w-]+:/.test(file) && !file.includes('node_modules/'))
    .map((file) => posix(path.relative(ROOT, path.resolve(file))));
}

function fresh() {
  const marker = JSON.parse(readFileSync(MARKER, 'utf8'));
  if (marker.version !== VERSION || !existsSync(path.join(ROOT, OUTPUT))) return false;
  if (sha(readFileSync(path.join(ROOT, OUTPUT))) !== marker.output) return false;
  if (JSON.stringify(listSkills()) !== JSON.stringify(marker.skills)) return false;
  return Object.entries(marker.inputs).every(([file, [size, mtimeMs, hash]]) => {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) return false;
    const stat = statSync(full);
    return (stat.size === size && stat.mtimeMs === mtimeMs) || sha(readFileSync(full)) === hash;
  });
}

function generate() {
  execFileSync(process.execPath, [path.join(ROOT, GENERATOR)], { stdio: 'inherit' });
}

/** Regenerates services/cli/src/generated/teaching.json unless its recorded inputs are unchanged. */
export async function generateTeaching() {
  try { if (fresh()) return 'cached'; } catch { /* no usable marker: generate */ }
  let inputs;
  try {
    // Hashed BEFORE generating: an edit made during generation is a miss next time, never a stale hit.
    const files = [...new Set([...TOOLS, ...listSkills(), ...await graphInputs()])].sort();
    inputs = Object.fromEntries(files.map((file) => [file, stamp(file)]));
  } catch { inputs = undefined; }
  generate();
  if (!inputs) return 'generated';
  mkdirSync(path.dirname(MARKER), { recursive: true });
  const temporary = `${MARKER}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: VERSION, inputs, skills: listSkills(), output: sha(readFileSync(path.join(ROOT, OUTPUT))) }));
  renameSync(temporary, MARKER);
  return 'generated';
}
