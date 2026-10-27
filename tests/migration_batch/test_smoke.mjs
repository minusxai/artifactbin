import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{createHash}from'node:crypto';
import{buildSmokeContract,compareSmoke,prepareSmoke,compareDirectories}from'../../scripts/migration_batch/smoke.mjs';import{pendingIds,createSmokeProbe}from'../../scripts/migration_batch/smoke-probe.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const s=json=>({static:true,json}),text=value=>({type:'text',value}),dyn={type:'expression',value:{static:false}};
const el=(tag,attrs,...children)=>({type:'element',tag,attributes:Object.entries(attrs).map(([name,v])=>({name,value:s(v)})),children});
const source='<h1 id="title">Revenue</h1>';
const nodes=[el('Helmet',{},el('Query',{name:'monthly'}),el('script',{})),
 el('header',{id:'top'},el('h1',{id:'title'},text('Revenue '),el('em',{id:'em'},text('grew')))),
 el('Tabs',{id:'tabs'},el('TabsTrigger',{id:'t1'},text('Overview'))),
 el('p',{id:'live'},text('Total: '),el('Cell',{id:'total',data:'$monthly'})),
 el('Chart',{id:'chart',data:'$monthly'}),el('DataTable',{id:'table',data:'$monthly'}),
 el('p',{id:'greeting'},text('Hi '),dyn),
 el('For',{id:'loop',each:'$monthly'},el('li',{id:'row'},dyn)),
 el('__mx_condition',{},el('p',{id:'maybe'},text('Only sometimes')))];
const result=()=>({key:{sourceId:'abc123',version:3},graph:{source,sourceSha256:hash(source)},analysis:{nodes:structuredClone(nodes),flow:{imports:[],queries:[{name:'monthly'}],values:[],mutations:[{name:'save'}]}}});

test('data pages, layout tags and controls are in scope; literal text is exact',()=>{
 const c=buildSmokeContract(result()),by=Object.fromEntries(c.entries.map(e=>[e.id,e]));
 assert.deepEqual([by.total.kind,by.chart.kind,by.table.kind,by.tabs.kind,by.top.kind],['cell','chart','table','control','element']);
 assert.equal(by.title.expectedText,'Revenue grew');assert.equal(by.live.expectedText,undefined);assert.equal(by.greeting.textLeaf,true);
 assert.equal(by.row.repeated,true);assert.equal(by.maybe.conditional,true);assert.equal(by.chart.query,'$monthly');
 assert.deepEqual(c.notExercised.mutations,['save']);assert.equal(c.notExercised.scripts,1);assert.deepEqual(c.notExercised.controls,['tabs','t1']);
});
test('binding defects still fail closed',()=>{
 const dup=result();dup.analysis.nodes.push(el('p',{id:'title'},text('again')));assert.throws(()=>buildSmokeContract(dup),/smoke_duplicate_id:title/);
 const anon=result();anon.analysis.nodes.push(el('Chart',{data:'$monthly'}));assert.throws(()=>buildSmokeContract(anon),/smoke_unidentified_chart/);
 const forged=result();forged.graph.sourceSha256='nope';assert.throws(()=>buildSmokeContract(forged),/smoke_source_binding/);
});

const contract=buildSmokeContract(result());
const inst=(text,extra={})=>({visible:true,busy:false,text,textLength:text.length,...extra});
function observe(side,over={}){
 const entries={top:{count:1,instances:[inst('Revenue grew')]},title:{count:1,instances:[inst('Revenue grew')]},em:{count:1,instances:[inst('grew')]},tabs:{count:1,instances:[inst('Overview')]},t1:{count:1,instances:[inst('Overview')]},
  live:{count:1,instances:[inst('Total: 42')]},total:{count:1,instances:[inst('42',{data:{loaded:true,value:'42'}})]},chart:{count:1,instances:[inst('',{data:{loaded:true,state:'ready',surface:true,marks:3,labels:['a','b','c']}})]},
  table:{count:1,instances:[inst('x',{data:{loaded:true,rows:3,headers:['month','revenue']}})]},greeting:{count:1,instances:[inst('Hi Sam')]},loop:{count:1,instances:[inst('')]},row:{count:2,instances:[inst('Jan'),inst('Feb')]},maybe:{count:0,instances:[]}};
 return{format:'migration-smoke-observation-v1',key:contract.key,contractSha256:contract.sha256,state:'initial',viewport:{width:390,height:844},regression:false,settled:true,pending:[],side,title:'t',entries:{...entries,...over}};
}
test('matching implementations pass',()=>{const r=compareSmoke(contract,observe('source'),observe('target'));assert.equal(r.status,'pass',JSON.stringify(r));assert.equal(r.checked,contract.entries.length)});
test('pending target chart is a product failure, not a pass (nPXoJA)',()=>{
 const r=compareSmoke(contract,observe('source'),observe('target',{chart:{count:1,instances:[inst('',{busy:true,data:{loaded:false,state:'pending',surface:false,marks:0,labels:[]}})]}}));
 assert.equal(r.status,'fail');assert.deepEqual(r.failures.map(f=>f.reason),['target_data_not_loaded']);
});
test('source that never loads is an exception, so nothing is claimed',()=>{
 const r=compareSmoke(contract,observe('source',{total:{count:1,instances:[inst('—',{data:{loaded:false,value:'—'}})]}}),observe('target'));
 assert.equal(r.status,'exception');assert.equal(r.exceptions[0].reason,'source_data_not_loaded');
});
test('content, values and structure differences are failures; practical differences are warnings',()=>{
 const r=compareSmoke(contract,observe('source'),observe('target',{title:{count:1,instances:[inst('Revenue fell')]},total:{count:1,instances:[inst('41',{data:{loaded:true,value:'41'}})]},row:{count:1,instances:[inst('Jan')]},tabs:{count:0,instances:[]},
  table:{count:1,instances:[inst('x',{data:{loaded:true,rows:2,headers:['month','revenue']}})]},top:{count:1,instances:[inst('Revenue grew',{visible:false})]}}));
 assert.deepEqual(r.failures.map(f=>f.id+':'+f.reason).sort(),['row:count_differs','tabs:count_differs','title:literal_text_differs','total:cell_value_differs']);
 assert.deepEqual(r.warnings.map(f=>f.id+':'+f.reason).sort(),['table:table_rows_differ','top:visibility_differs']);
});
test('observations must belong to this contract, state and viewport',()=>{
 assert.throws(()=>compareSmoke(contract,observe('source'),{...observe('target'),contractSha256:'other'}),/smoke_observation_binding/);
 assert.throws(()=>compareSmoke(contract,observe('target'),observe('target')),/smoke_observation_binding/);
});
test('pending ids cover busy and unloaded data only',()=>{
 assert.deepEqual(pendingIds(contract,observe('target')),[]);
 assert.deepEqual(pendingIds(contract,observe('target',{total:{count:1,instances:[inst('42',{busy:true,data:{loaded:true,value:'42'}})]}})),['total']);
});

async function scratch(){return fs.mkdtemp(path.join(os.tmpdir(),'migration-smoke-'))}
test('prepare binds packet and result by hash and writes a self-contained probe; compare pairs normal captures',async()=>{
 const root=await scratch();try{
  const resultBytes=JSON.stringify(result()),resultPath=path.join(root,'result.json');await fs.writeFile(resultPath,resultBytes);
  const packetBytes=JSON.stringify({status:'converted',key:{sourceId:'abc123',version:3},result:{path:resultPath,sha256:hash(resultBytes)}}),packetPath=path.join(root,'packet.json');await fs.writeFile(packetPath,packetBytes);
  await assert.rejects(prepareSmoke({packetPath,packetSha256:'0'.repeat(64),output:path.join(root,'bad')}),/smoke_packet_digest/);
  const out=path.join(root,'prepared'),prepared=await prepareSmoke({packetPath,packetSha256:hash(packetBytes),output:out});
  assert.equal(prepared.counts.chart,1);await assert.rejects(prepareSmoke({packetPath,packetSha256:hash(packetBytes),output:out}),/EEXIST/);
  // The camera loader imports the probe alone from scratch.
  const alone=path.join(root,'alone');await fs.mkdir(alone);await fs.copyFile(prepared.probe.path,path.join(alone,'probe.mjs'));const probe=await import(path.join(alone,'probe.mjs'));
  assert.equal(probe.contract.sha256,contract.sha256);await assert.rejects(probe.mountImportedPilot({frame:{},reader:{version:2},state:{id:'initial',actions:[]}}),/smoke_probe_scope/);
  const src=path.join(root,'src'),tgt=path.join(root,'tgt');await fs.mkdir(src);await fs.mkdir(tgt);
  await fs.writeFile(path.join(src,'smoke-source-initial-390x844-normal.json'),JSON.stringify(observe('source')));await fs.writeFile(path.join(tgt,'smoke-target-initial-390x844-normal.json'),JSON.stringify(observe('target')));
  assert.equal((await compareDirectories({contractPath:prepared.contract.path,sourceDirectory:src,targetDirectory:tgt})).status,'pass');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('probe settles on two agreeing observations and records an unsettled page instead of throwing',async()=>{
 const root=await scratch();try{
  let n=0;const frame={evaluate:async(fn)=>fn.name==='observePage'?(n++,{side:'target',title:'t',entries:observe('target').entries}):undefined};
  const hooks=await createSmokeProbe(contract,{intervalMs:1})({frame,reader:{version:3,pageId:'p'},state:{id:'initial',actions:[]},viewport:{width:390,height:844},regression:false,output:root});
  await hooks.ready();await hooks.cleanup();assert.equal(n,2);
  const stuck={evaluate:async(fn)=>fn.name==='observePage'?{side:'target',title:'t',entries:observe('target',{chart:{count:1,instances:[inst('',{busy:true,data:{loaded:false}})]}}).entries}:undefined};
  const late=await createSmokeProbe(contract,{deadlineMs:5,intervalMs:1})({frame:stuck,reader:{version:3,pageId:'p'},state:{id:'initial',actions:[]},viewport:{width:390,height:844},regression:true,output:root});
  await late.ready();const saved=JSON.parse(await fs.readFile(path.join(root,'smoke-target-initial-390x844-regression.json'),'utf8'));assert.equal(saved.settled,false);assert.deepEqual(saved.pending,['chart']);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
