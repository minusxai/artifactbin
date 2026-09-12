/** CI-only runtime build. Pin source identity and configure flags together; cache by this recipe. */
import {mkdir,readFile,writeFile,copyFile,chmod,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const version='22.22.3';
// https://nodejs.org/dist/v22.22.3/SHASUMS256.txt
const checksum='f3e6a578db1ab335a4a72785c1e87ad18a2cf6d2fc25747a1d741fb34af0bd0f';
if(!process.env.CI)throw new Error('Custom Node source builds run only in CI.');
const root=resolve('node_modules/.cache/cli-node'),binary=join(root,'node');
await mkdir(root,{recursive:true});
let exists=false;try{await access(binary);exists=true;}catch{}
if(!exists){
 const archive=join(root,`node-v${version}.tar.xz`);
 execFileSync('curl',['--fail','--location','--proto','=https','--proto-redir','=https','--retry','3','--output',archive,`https://nodejs.org/dist/v${version}/node-v${version}.tar.xz`],{stdio:'inherit'});
 assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),checksum,'Node source checksum');
 execFileSync('tar',['-xJf',archive,'-C',root],{stdio:'inherit'});
 const source=join(root,`node-v${version}`);
 execFileSync('./configure',['--with-intl=small-icu'],{cwd:source,stdio:'inherit'});
 execFileSync('make',[`-j${availableParallelism()}`],{cwd:source,stdio:'inherit'});
 await copyFile(join(source,'out/Release/node'),binary);await chmod(binary,0o755);
}
execFileSync(binary,['-e',`const a=require('node:assert/strict');a.equal(process.version,'v${version}');a.equal(process.config.variables.icu_small,true);a.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(['en','fr','ja']),['en']);a.equal('e\\u0301'.normalize(),'é');a.equal(new URL('https://bücher.example').hostname,'xn--bcher-kva.example');require('node:sqlite');require('node:sea');require('node:crypto').randomBytes(32);`],{stdio:'inherit'});
await writeFile(join(root,'recipe.json'),JSON.stringify({version,checksum,intl:'small-icu',platform:process.platform,arch:process.arch})+'\n');
console.log(`Verified small-ICU runtime: ${binary}`);
