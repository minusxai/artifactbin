/** Stage the built CLI outside the protected checkout; an eval never falls back to a global afbin. */
import {copyFileSync,mkdirSync,chmodSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function materializeCli(dir:string,source=fileURLToPath(new URL('../../services/cli/dist/afbin.mjs',import.meta.url))):string{
 if(!existsSync(source))throw new Error('Build the CLI before running evals: npm run build -w services/cli');
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
