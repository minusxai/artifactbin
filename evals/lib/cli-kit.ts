/** Stage the built CLI outside the protected checkout; an eval never falls back to a global afbin. */
import {copyFileSync,mkdirSync,chmodSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const DIST=fileURLToPath(new URL('../../services/cli/dist/',import.meta.url));
/** The platform binary `build:binary` writes, named the way the release and the installer name it. */
export function platformBinary(dist=DIST):string{
 return path.join(dist,`afbin-${process.platform}-${process.arch}${process.platform==='win32'?'.exe':''}`);
}
/**
 * WHICH BUILD IS STAGED. The platform binary when it exists, the `.mjs` bundle otherwise. The bundle
 * declares `@duckdb/node-api` external and resolves it from a `node_modules` beside itself, which a
 * copy in the run home does not have — so every local `afbin query <file.csv>` in an installed-mode
 * leg failed with "Cannot find package '@duckdb/node-api'" (run 34696655937: four agents, then each
 * re-ran the SQL against the published dataset). The binary embeds DuckDB (`scripts/duckdb-native.mjs`),
 * and it is what the not-installed flow installs, so staging it puts both modes on the same CLI.
 */
export function stagedCliSource(dist=DIST):string{
 const binary=platformBinary(dist);
 return existsSync(binary)?binary:path.join(dist,'afbin.mjs');
}
export function materializeCli(dir:string,source=stagedCliSource()):string{
 if(!existsSync(source))throw new Error('Build the CLI before running evals: npm run build -w services/cli, and npm run build:binary -w services/cli for the binary that can run local queries');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const executable=path.join(dir,'afbin');copyFileSync(source,executable);chmodSync(executable,0o755);
 return dir;
}

/**
 * The agent's sandbox must never open the user's real browser: the CLI's automatic approval flow
 * launches `open` (macOS) or `xdg-open` (Linux), which on a developer machine lands in Chrome. The
 * driver approves pairings itself, so both are shadowed by no-op executables placed first on PATH.
 */
export function browserShims(dir:string):string{
 mkdirSync(dir,{recursive:true,mode:0o700});
 for(const name of ['open','xdg-open']){const file=path.join(dir,name);writeFileSync(file,'#!/bin/sh\nexit 0\n');chmodSync(file,0o755);}
 return dir;
}
