/** CI-only runtime build. Pin source identity and configure flags together; cache by this recipe. */
import {mkdir,readFile,writeFile,copyFile,chmod,access,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const version='22.22.3';
// https://nodejs.org/dist/v22.22.3/SHASUMS256.txt
const checksum='f3e6a578db1ab335a4a72785c1e87ad18a2cf6d2fc25747a1d741fb34af0bd0f';
if(!process.env.CI)throw new Error('Custom Node source builds run only in CI.');
const images={
 x64:'quay.io/pypa/manylinux_2_28_x86_64@sha256:53390351aeb4688114b02c36a23b3e6ce1166ee9b7afc5df1a4f776354fc764c',
 arm64:'quay.io/pypa/manylinux_2_28_aarch64@sha256:ad74e53b713f3b07d8c889c526dc0c6500da9827b45e38739570875fef52e28f',
};
const recipe={version,checksum,intl:'small-icu',platform:process.platform,arch:process.arch,...(process.platform==='linux'?{image:images[process.arch],partlyStatic:true,elfType:'EXEC'}:{})};
const root=resolve('node_modules/.cache/cli-node'),binary=join(root,'node');
await mkdir(root,{recursive:true});
let exists=false;try{await access(binary);exists=JSON.stringify(JSON.parse(await readFile(join(root,'recipe.json'),'utf8')))===JSON.stringify(recipe);}catch{}
if(!exists)await rm(binary,{force:true});
if(!exists){
 const archive=join(root,`node-v${version}.tar.xz`);
 execFileSync('curl',['--fail','--location','--proto','=https','--proto-redir','=https','--retry','3','--output',archive,`https://nodejs.org/dist/v${version}/node-v${version}.tar.xz`],{stdio:'inherit'});
 assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),checksum,'Node source checksum');
 execFileSync('tar',['-xJf',archive,'-C',root],{stdio:'inherit'});
 const source=join(root,`node-v${version}`);
 if(process.platform==='linux'){
  // Preserve Node 22's glibc 2.28 baseline; do not link against the newer runner's libc/libstdc++.
  if(!images[process.arch])throw new Error('Unsupported Linux runtime architecture.');
  execFileSync('docker',['run','--rm','--network','none','-v',`${root}:/runtime`,'-w',`/runtime/node-v${version}`,images[process.arch],'bash','-c',`export PATH=/opt/python/cp311-cp311/bin:$PATH; export LDFLAGS=-no-pie; ./configure --with-intl=small-icu --partly-static && make -j${availableParallelism()}`],{stdio:'inherit'});
 }else{
  execFileSync('./configure',['--with-intl=small-icu'],{cwd:source,stdio:'inherit'});
  execFileSync('make',[`-j${availableParallelism()}`],{cwd:source,stdio:'inherit'});
 }
 await copyFile(join(source,'out/Release/node'),binary);await chmod(binary,0o755);
}
execFileSync(binary,['-e',`const a=require('node:assert/strict');a.equal(process.version,'v${version}');a.equal(process.config.variables.icu_small,true);a.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(['en','fr','ja']),['en']);a.equal('e\\u0301'.normalize(),'é');a.equal(new URL('https://bücher.example').hostname,'xn--bcher-kva.example');require('node:sqlite');require('node:sea');require('node:crypto').randomBytes(32);`],{stdio:'inherit'});
if(process.platform==='linux'){
 // Match official Node's ET_EXEC layout; postject's old LIEF corrupts large GNU hashes in PIE.
 // https://github.com/nodejs/postject/pull/108
 assert.match(execFileSync('readelf',['-h',binary],{encoding:'utf8'}),/Type:\s+EXEC\b/,'SEA runtime must use ET_EXEC');
 const symbols=execFileSync('readelf',['--version-info',binary],{encoding:'utf8'});
 for(const match of symbols.matchAll(/Name: GLIBC_(\d+)\.(\d+)/g))assert.ok(Number(match[1])<2||Number(match[1])===2&&Number(match[2])<=28,`Runtime requires ${match[0]}`);
 assert.ok(!/Name: GLIBCXX_/.test(symbols),'C++ runtime must be statically linked');
}
await writeFile(join(root,'recipe.json'),JSON.stringify(recipe)+'\n');
console.log(`Verified small-ICU runtime: ${binary}`);
