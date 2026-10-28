import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';

test('uninstall removes the setup skills and the npm package; --purge also removes ~/.artifactbin',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-uninstall-'));const calls:string[][]=[];const out:string[]=[];
 const claude=join(home,'.claude','skills','artifactbin'),state=join(home,'.artifactbin');
 try{
  await mkdir(claude,{recursive:true});await mkdir(state,{recursive:true});
  const context={home,cwd:home,env:{PATH:''},interactive:false,stdout:(s:string)=>out.push(s),stderr:(s:string)=>out.push(s),npm:async(args:string[])=>{calls.push(args);return {code:0,stdout:'',stderr:''};}};
  assert.notEqual(await runCli(['uninstall'],context),0);
  await stat(claude);assert.equal(calls.length,0);
  assert.equal(await runCli(['uninstall','--yes'],context),0,out.join(''));
  await assert.rejects(stat(claude),{code:'ENOENT'});await stat(state);
  assert.deepEqual(calls,[['uninstall','-g','@afbin/cli']]);
  assert.equal(await runCli(['uninstall','--purge','--yes'],context),0);
  await assert.rejects(stat(state),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
