import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostedHarnessArguments} from '../src/hosted-agent';
test('Claude reuses its explicit session only after a transcript exists, including a login-only restart',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 const first=await hostedHarnessArguments('claude',home,'context');
 assert.ok(first.includes('--session-id'));const id=first[first.indexOf('--session-id')+1]!;
 assert.deepEqual(await hostedHarnessArguments('claude',home,'context'),first);
 await mkdir(join(home,'.claude','projects','-home-runner'),{recursive:true});
 await writeFile(join(home,'.claude','projects','-home-runner',id+'.jsonl'),'{}\n');
 const resumed=await hostedHarnessArguments('claude',home,'context');assert.ok(resumed.includes('--resume'));assert.equal(resumed[resumed.indexOf('--resume')+1],id);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('Codex resumes an explicit retained session and ignores malformed or other workspace transcripts',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 assert.ok(!(await hostedHarnessArguments('codex',home,'context')).includes('resume'));
 const dir=join(home,'.codex','sessions','2026');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'other.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'other',cwd:'/different'}})+'\n');
 await writeFile(join(dir,'broken.jsonl'),'{');
 assert.ok(!(await hostedHarnessArguments('codex',home,'context')).includes('resume'));
 const id='a37c7d1b-c1f0-445b-883e-21c29b385a28';await writeFile(join(dir,'session.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:home,source:'cli'}})+'\n');
 const args=await hostedHarnessArguments('codex',home,'context');
 await writeFile(join(dir,'newer.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'b37c7d1b-c1f0-445b-883e-21c29b385a28',cwd:home,source:'exec'}})+'\n');
 assert.deepEqual(await hostedHarnessArguments('codex',home,'context'),args);assert.equal(args[0],'resume');assert.ok(args.includes(id));assert.ok(!args.includes('--last'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('Pi always opens its one explicit retained journal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 const args=await hostedHarnessArguments('pi',home,'context');
 assert.equal(args[0],'--session');assert.equal(args[1],join(home,'.artifactbin','hosted-agent','pi-session.jsonl'));
 await writeFile(args[1]!,'{"type":"session"}\n');assert.deepEqual(await hostedHarnessArguments('pi',home,'context'),args);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('OpenCode pins the first owned root session and never switches to a newer thread',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 let rows='';const list=async()=>rows;
 assert.deepEqual(await hostedHarnessArguments('opencode',home,'context',list),['--prompt','context']);
 rows=JSON.stringify([{id:'ses_later',directory:home,created:200},{id:'ses_first',directory:home,created:100},{id:'ses_other',directory:'/other',created:1},{id:'ses_child',directory:home,parentID:'ses_first',created:0}]);
 const args=await hostedHarnessArguments('opencode',home,'context',list);assert.deepEqual(args,['--session','ses_first','--prompt','context']);
 assert.deepEqual(await hostedHarnessArguments('opencode',home,'context',async()=>{throw Error('must not rediscover pinned identity');}),args);
 }finally{await rm(home,{recursive:true,force:true});}
});
