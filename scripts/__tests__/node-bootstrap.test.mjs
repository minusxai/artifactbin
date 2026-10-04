import {it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const helper=new URL('../../services/app/public/chat/ensure-node.sh',import.meta.url).pathname;
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-'));try{await mkdir(join(root,'bin'));for(const name of ['uname','mktemp','rm','awk','shasum','sha256sum','tar','mkdir','mv','grep','cp','perl']){const found=spawnSync('/bin/sh',['-c','command -v "$1"','sh',name],{encoding:'utf8'}).stdout.trim();if(found)await symlink(found,join(root,'bin',name));}await run(root);}finally{await rm(root,{recursive:true,force:true});}}
async function executable(root,name,text){await rm(join(root,'bin',name),{force:true});await writeFile(join(root,'bin',name),text,{mode:0o755});}
it('reuses a supported Node with working npm/npx without downloading or modifying shell files',()=>fixture(async root=>{
 await executable(root,'node',`#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
 for(const name of ['npm','npx'])await executable(root,name,'#!/bin/sh\necho 11.0.0\n');
 await executable(root,'curl','#!/bin/sh\necho unexpected-download >&2\nexit 88\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'; . '${helper}'`],{env:{...process.env,HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Node and npm/npx are ready');
 await expect(readFile(join(root,'.profile'),'utf8')).rejects.toThrow();
}));
it.each(['absent','old','broken npm'])('fails clearly on download failure for %s and leaves existing installation untouched',scenario=>fixture(async root=>{
 if(scenario!=='absent')await executable(root,'node',scenario==='old'?'#!/bin/sh\nexit 1\n':`#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
 await executable(root,'npm','#!/bin/sh\nexit 1\n');await executable(root,'npx','#!/bin/sh\nexit 1\n');
 await executable(root,'curl','#!/bin/sh\nexit 22\n');
 const result=spawnSync('/bin/bash',['-c',`. '${helper}'`],{env:{...process.env,HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('https://nodejs.org/en/download');
}));
it('installs a verified archive into user storage and persists PATH once across repeated preparation',()=>fixture(async root=>{
 const {createHash}=await import('node:crypto');
 const unpack=join(root,'node-v24.21.0-darwin-arm64');await mkdir(join(unpack,'bin'),{recursive:true});
 await writeFile(join(unpack,'bin/node'),`#!/bin/sh\nexec '${process.execPath}' "$@"\n`,{mode:0o755});
 for(const name of ['npm','npx'])await writeFile(join(unpack,'bin',name),'#!/bin/sh\necho 11.0.0\n',{mode:0o755});
 const archive=join(root,'fixture.tar.gz');expect(spawnSync('/usr/bin/tar',['-czf',archive,'-C',root,'node-v24.21.0-darwin-arm64']).status).toBe(0);
 const hash=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(join(root,'sums'),`${hash}  node-v24.21.0-darwin-arm64.tar.gz\n`);
 await executable(root,'uname','#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n');
 await executable(root,'curl',`#!/bin/sh\ncase "$2" in *SHASUMS256.txt) cp '${join(root,'sums')}' "$4";; *) cp '${archive}' "$4";; esac\n`);
 const result=spawnSync('/bin/bash',['-c',`. '${helper}' && . '${helper}' && node --version && npm --version && npx --version`],{env:{...process.env,HOME:root,PATH:join(root,'bin')},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Node and npm/npx are ready');
 for(const file of ['.profile','.bashrc','.bash_profile','.zshrc'])expect((await readFile(join(root,file),'utf8')).match(/# artifactbin Node/g)).toHaveLength(1);
}));
