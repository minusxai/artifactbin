import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {stopTeamHost} from '../scripts/team-host-process.mjs';

for(const mode of ['graceful','orphan','stuck'])test(`team acceptance cleanup closes inherited pipes with ${mode} shutdown`,{skip:process.platform==='win32',timeout:5000},async()=>{
 const stubborn=mode!=='graceful';
 const descendant=`process.on('SIGTERM',()=>${stubborn?'{}':'process.exit(0)'});setInterval(()=>{},1000);console.log('ready');`;
 const script=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});process.on('SIGTERM',()=>{${mode==='stuck'?'':stubborn?'process.exit(0)':'child.kill("SIGTERM");child.once("exit",()=>process.exit(0));'}});`;
 const server=spawn(process.execPath,['-e',script],{detached:true,stdio:['ignore','pipe','pipe']});
 let closed=false;server.once('close',()=>{closed=true;});
 try{
  await once(server.stdout,'data');
  await stopTeamHost(server,100);
  assert.equal(closed,true,'cleanup must close pipes held by the supervisor and its descendants');
 }finally{
  try{process.kill(-server.pid!,'SIGKILL');}catch{}
  if(!closed)await once(server,'close');
 }
});
