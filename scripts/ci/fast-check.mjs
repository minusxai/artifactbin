import { execFileSync, spawnSync } from 'node:child_process';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';

// esbuild parses all checked-in executable JS in-process (including config/scripts),
// avoiding hundreds of Node startups. TypeScript and TSX are covered by validate.
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(file => /\.(?:mjs|cjs|js)$/.test(file));
await Promise.all(files.map(file => transform(readFileSync(file,'utf8'), {loader:'js',sourcefile:file,logLevel:'silent'})));
console.log(`JavaScript syntax: ${files.length} files parsed.`);
const result = spawnSync(process.execPath,['scripts/ci/fast-tests.mjs'],{stdio:'inherit'});
process.exitCode = result.status ?? 1;
