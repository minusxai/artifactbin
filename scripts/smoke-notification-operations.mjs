#!/usr/bin/env node
/** Deterministic CLI half of docs/mutation-notifications/demo.md.
 * Run after the first single-row write and before the browser recovery checks.
 * This is a disposable fixture operation, never point it at an existing user dataset.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return [arg.slice(0,i),arg.slice(i+1)];}));
const document=options['--document'],cwd=options['--cwd']&&resolve(options['--cwd']);
assert.ok(document&&/^[A-Za-z0-9]+$/.test(document)&&cwd,'--document=ID --cwd=fixture-workspace required');
assert.equal(options['--disposable'],'yes','Pass --disposable=yes only for the documented seeded task fixture');
const outcomes=[];
function cli(args,expectFailure=false,extraEnv={}){
 const run=spawnSync('npm',['run','afbin','--',...args,'--json'],{cwd,env:{...process.env,...extraEnv},encoding:'utf8',maxBuffer:20*1024*1024});
 let body;for(const line of run.stdout.trim().split('\n').reverse()){try{body=JSON.parse(line);break;}catch{}}
 assert.ok(body,`CLI did not return JSON (${run.status})`);
 assert.equal(run.status===0,!expectFailure,JSON.stringify(body));
 return body;
}
function rows(){const result=cli(['query',document,'--name','tasks_list']);return result.results[0].rows;}
function write(name,params){
 const result=cli(['query',document,'--write','--name',name,...Object.entries(params).flatMap(([key,value])=>['--param',`${key}=${value}`])]);
 assert.equal(typeof result.mutationRunId,'string','Notification-bearing success exposes run discovery ID');
 outcomes.push({name,...result});return result;
}
const before=rows();
assert.equal(before.length,7,'seven seeded rows');
assert.deepEqual(before.map(row=>row.status),['Done','Todo','Todo','Todo','Todo','Todo','Todo'],'run the initial single-row scenario first');
assert.equal(write('bulk_status',{status:'Done',expected_status:'Todo'}).affected,6);
assert.deepEqual(rows().map(row=>row.status),Array(7).fill('Done'));
assert.equal(write('zero_match',{task_id:999,status:'Done'}).affected,0);
const target=outcomes[0].id;
const versionBeforeRefusal=cli(['list',target]).version;
const refused=cli(['query',document,'--write','--name','change_status','--param','task_id=999','--param','status=Done','--param','expected_status=Todo'],true);
assert.ok(refused.error&&!refused.mutationRunId,'guard refusal creates no run');
assert.equal(cli(['list',target]).version,versionBeforeRefusal,'guard refusal leaves data version unchanged');
assert.deepEqual(rows().map(row=>row.status),Array(7).fill('Done'));

// Reuse the original journal entry after an unknown response; a fresh successful write
// would prove only that deliberate new runs get distinct IDs.
const replayArgs=['query',document,'--write','--name','zero_match','--param','task_id=999','--param','status=Done'];
const receipt=resolve(mkdtempSync(resolve(tmpdir(),'notify-replay-')),'committed.json');
const preload=fileURLToPath(new URL('./fixtures/drop-notification-response.mjs',import.meta.url));
const uncertain=cli(replayArgs,true,{NOTIFY_SMOKE__DOCUMENT:document,NOTIFY_SMOKE__RECEIPT:receipt,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${preload}`});
assert.equal(uncertain.error?.code,'outcome_unknown');
const committed=JSON.parse(readFileSync(receipt,'utf8'));
const recovered=cli(replayArgs);
for(const key of ['mutationRunId','version','affected'])assert.equal(recovered[key],committed[key],`replay preserves ${key}`);
assert.equal(cli(['list',target]).version,recovered.version,'replay does not write again');

const failedOutput=write('repairable',{task_id:1,status:''});
assert.equal(rows()[0].status,'','mutation commits independently of bad notification output');
console.log(JSON.stringify({stage:'failed-output',runId:failedOutput.mutationRunId}));
// Stop here: the browser half must observe the failed job before a repair can change current state.
const evidence={document,bulk:outcomes[0],zero:outcomes[1],failedOutput,replay:{committed,recovered},guardRefused:true};
if(options['--output'])writeFileSync(resolve(options['--output']),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
