import { execFileSync, spawnSync } from 'node:child_process';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';

// esbuild parses all checked-in executable JS in-process (including config/scripts),
// avoiding hundreds of Node startups. TypeScript and TSX are covered by validate.
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(file => /\.(?:mjs|cjs|js)$/.test(file));
// check.mjs steps files in the skill's examples are async function bodies (top-level await and return),
// so they parse wrapped as one, the way check.mjs runs them.
const stepsBody = file => /skills\/artifactbin\/examples\/[a-z0-9-]+-(?:steps|guest|cleanup)\.mjs$/.test(file);
await Promise.all(files.map(file => {
  const code = readFileSync(file,'utf8');
  return transform(stepsBody(file) ? `(async (page, step) => {${code}\n})` : code, {loader:'js',sourcefile:file,logLevel:'silent'});
}));
console.log(`JavaScript syntax: ${files.length} files parsed.`);
const result = spawnSync(process.execPath,['scripts/ci/fast-tests.mjs'],{stdio:'inherit'});
process.exitCode = result.status ?? 1;
