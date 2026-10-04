/** CI-only bootstrap from an actually Node-free PATH with the official LTS archive. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform==='win32')throw new Error('Use test-node-bootstrap.ps1 for standard-user Windows.');
const home=await mkdtemp(join(tmpdir(),'afbin-node-bootstrap-'));
try{
 const tools=join(home,'tools');await mkdir(tools);
 for(const tool of ['curl','tar','uname','awk','mktemp','rm','mkdir','mv','grep','shasum','sha256sum']){
   try{const file=execFileSync('/bin/sh',['-c','command -v "$1"','sh',tool],{encoding:'utf8'}).trim();if(file)await symlink(file,join(tools,tool));}catch{}
 }
 const helper=resolve('services/app/public/chat/ensure-node.sh');
 const output=execFileSync('/bin/bash',['-c',`command -v node && exit 99; . "$1" && . "$1" && node --version && npm --version && npx --version`,'bash',helper],{env:{...process.env,HOME:home,PATH:tools},encoding:'utf8',timeout:300000});
 assert.match(output,/v24\.21\.0/);
 for(const file of ['.profile','.bashrc','.bash_profile','.zshrc'])assert.equal((await readFile(join(home,file),'utf8')).match(/# artifactbin Node/g)?.length,1);
 // A fresh shell must obtain npm/npx through durable PATH preparation.
 const fresh=execFileSync('/bin/bash',['-c','. "$HOME/.profile" && node --version && npm --version && npx --version'],{env:{...process.env,HOME:home,PATH:tools},encoding:'utf8'});assert.match(fresh,/v24\.21\.0/);
 console.log('PASS official absent-Node bootstrap, repeat, current and future PATH');
}finally{await rm(home,{recursive:true,force:true});}
