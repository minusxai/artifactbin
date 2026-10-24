import {it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const helper=new URL('../../services/app/public/chat/ensure-node.sh',import.meta.url).pathname;
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-'));try{await mkdir(join(root,'bin'));for(const name of ['uname','mktemp','rm','awk','shasum','sha256sum','tar','gzip','mkdir','mv','grep','cp','perl']){const found=spawnSync('/bin/sh',['-c','command -v "$1"','sh',name],{encoding:'utf8'}).stdout.trim();if(found)await symlink(found,join(root,'bin',name));}await run(root);}finally{await rm(root,{recursive:true,force:true});}}
async function executable(root,name,text){await rm(join(root,'bin',name),{force:true});await writeFile(join(root,'bin',name),text,{mode:0o755});}
const fakeNode = `#!/bin/sh
if [ "$1" = -e ]; then
 shift
 exec '${process.execPath}' -e 'Object.defineProperty(process.versions,"node",{value:process.env.FIXTURE_NODE_VERSION||"24.22.1"});const code=process.argv[1];process.argv.splice(1,1);eval(code)' "$@"
fi
exec '${process.execPath}' "$@"
`;
it('reuses a supported Node with working npm/npx without downloading or modifying shell files',()=>fixture(async root=>{
 await executable(root,'node',fakeNode);
 for(const name of ['npm','npx'])await executable(root,name,'#!/bin/sh\necho 11.19.2\n');
 await executable(root,'curl','#!/bin/sh\necho unexpected-download >&2\nexit 88\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'; . '${helper}'`],{env:{...process.env,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Node and npm/npx are ready');
 await expect(readFile(join(root,'.profile'),'utf8')).rejects.toThrow();
}));
it.each(['absent','old','broken npm'])('fails clearly on download failure for %s and leaves existing installation untouched',scenario=>fixture(async root=>{
 if(scenario!=='absent')await executable(root,'node',scenario==='old'?'#!/bin/sh\nexit 1\n':fakeNode);
 await executable(root,'npm','#!/bin/sh\nexit 1\n');await executable(root,'npx','#!/bin/sh\nexit 1\n');
 await executable(root,'curl','#!/bin/sh\nexit 22\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'`],{env:{...process.env,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('https://nodejs.org/en/download');
}));
it('installs a verified archive into user storage and persists PATH once across repeated preparation',()=>fixture(async root=>{
 const {createHash}=await import('node:crypto');
 const unpack=join(root,'node-v24.22.1-darwin-arm64');await mkdir(join(unpack,'bin'),{recursive:true});
 await writeFile(join(unpack,'bin/node'),fakeNode,{mode:0o755});
 await mkdir(join(unpack,'lib/node_modules/npm/node_modules'),{recursive:true});
 for(const name of ['npm','npx'])await writeFile(join(unpack,'bin',name),`#!/bin/sh
if [ "$1" = install ] && [ "$2" = --prefix ]; then
 mkdir -p "$3/node_modules/brace-expansion" "$3/node_modules/ip-address" "$3/node_modules/postcss-selector-parser" "$3/node_modules/undici"
 printf '%s' '{"version":"5.0.12"}' > "$3/node_modules/brace-expansion/package.json"
 printf '%s' '{"version":"7.1.6"}' > "$3/node_modules/postcss-selector-parser/package.json"
 printf '%s' '{"version":"10.7.4"}' > "$3/node_modules/ip-address/package.json"
 printf '%s' '{"version":"6.29.1"}' > "$3/node_modules/undici/package.json"
fi
echo 11.19.2
`,{mode:0o755});
 const archive=join(root,'fixture.tar.gz');expect(spawnSync('/usr/bin/tar',['-czf',archive,'-C',root,'node-v24.22.1-darwin-arm64']).status).toBe(0);
 const hash=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(join(root,'sums'),`${hash}  node-v24.22.1-darwin-arm64.tar.gz\n`);
 await executable(root,'uname','#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n');
 await executable(root,'curl',`#!/bin/sh\ncase "$2" in *SHASUMS256.txt) cp '${join(root,'sums')}' "$4";; *) cp '${archive}' "$4";; esac\n`);
 const result=spawnSync('/bin/bash',['-c',`. '${helper}' && . '${helper}' && node --version && npm --version && npx --version`],{env:{...process.env,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Node and npm/npx are ready');
 for(const file of ['.profile','.bashrc','.bash_profile','.zshrc'])expect((await readFile(join(root,file),'utf8')).match(/# artifactbin Node/g)).toHaveLength(1);
}));

it.each([
 ['22.23.3',false],['22.23.4',true],['22.24.0',true],['23.11.0',false],
 ['24.21.0',false],['24.22.0',false],['24.22.1',true],['25.9.0',false],
 ['26.12.0',false],['26.12.1',true],['27.0.0',true],
])('selects a patched private runtime only when existing Node %s is affected (reuse=%s)',(version,reuse)=>fixture(async root=>{
 await executable(root,'node',fakeNode);
 for(const name of ['npm','npx'])await executable(root,name,'#!/bin/sh\necho 11.19.2\n');
 await executable(root,'curl','#!/bin/sh\nexit 22\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'`],{env:{...process.env,FIXTURE_NODE_VERSION:version,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status===0,result.stderr).toBe(reuse);
 await expect(readFile(join(root,'.profile'),'utf8')).rejects.toThrow();
}));
it.each(['10.9.9','11.19.0','11.19.1','12.2.0','12.2.1','12.2.2'])('does not reuse incompatible or unpatched npm %s',version=>fixture(async root=>{
 await executable(root,'node',fakeNode);
 for(const name of ['npm','npx'])await executable(root,name,`#!/bin/sh\necho ${version}\n`);
 await executable(root,'curl','#!/bin/sh\nexit 22\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'`],{env:{...process.env,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status).not.toBe(0);
 await expect(readFile(join(root,'.profile'),'utf8')).rejects.toThrow();
}));

it('reuses the exact patched npm bundle without replacing the user installation',()=>fixture(async root=>{
 await executable(root,'node',fakeNode);
 for(const name of ['npm','npx'])await executable(root,name,'#!/bin/sh\necho 11.19.1\n');
 for(const [name,version]of [['brace-expansion','5.0.12'],['ip-address','10.7.4'],['postcss-selector-parser','7.1.6'],['undici','6.29.1']]){
  const directory=join(root,'node_modules',name);await mkdir(directory,{recursive:true});await writeFile(join(directory,'package.json'),JSON.stringify({version}));
 }
 await executable(root,'curl','#!/bin/sh\nexit 99\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'`],{env:{...process.env,BASH_ENV:'',ENV:'',HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Node and npm/npx are ready');
 expect(await readdir(root)).not.toContain('.artifactbin');
}));
