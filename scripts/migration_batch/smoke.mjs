#!/usr/bin/env node
/** Functional smoke for converted heads: readable content, data and controls on both implementations.
 * Replaces exact literal-only checks. Data-bound pages are in scope; unknown tags are observed, not refused.
 * It never accepts an artifact, acquires a browser or writes production. Final review stays independent.
 */
import fs from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex'),norm=s=>String(s??'').replace(/\s+/g,' ').trim();
const fail=code=>{throw Object.assign(Error(code),{smokeCode:code})};
const DATA={Cell:'cell',Chart:'chart',DataTable:'table',Mermaid:'diagram'};
const CONTROLS=new Set(['Button','Select','Slider','Input','Tabs','TabsTrigger','button','input','select','textarea','summary']);
const OPAQUE=new Set(['script','style','svg','template','iframe','object','embed']);
const attr=(n,k)=>n.attributes?.find(a=>a.name===k)?.value;
const isText=n=>(n.type==='text'&&norm(n.value))||(n.type==='expression'&&(n.value?.static!==true||norm(n.value.json)));
/** Literal text of a subtree of plain HTML, or null when a component, opaque tag or dynamic value decides it. */
function literal(n){
 if(n.type==='text')return String(n.value);
 if(n.type==='expression')return n.value?.static===true&&['string','number'].includes(typeof n.value.json)?String(n.value.json):null;
 if(n.type!=='element'||!/^[a-z][a-z0-9]*$/.test(n.tag)||OPAQUE.has(n.tag))return null;
 let out='';for(const c of n.children??[]){const t=literal(c);if(t===null)return null;out+=t}return out;
}

/** @param {{key:{sourceId:string;version:number};graph:{sourceSha256:string};analysis:{nodes:unknown[];flow:Record<string,unknown[]>}}} result
 * @returns {import('./smoke-contracts.mjs').SmokeContract} */
export function buildSmokeContract(result){
 const key=result?.key;if(typeof key?.sourceId!=='string'||!Number.isInteger(key.version)||key.version<1||!/^[0-9a-f]{64}$/.test(result.graph?.sourceSha256??''))fail('smoke_source_binding');
 const entries=[],seen=new Map(),notExercised={controls:[],mutations:(result.analysis.flow?.mutations??[]).map(m=>m.name),scripts:0,conditionalIds:0,repeatedIds:0};
 const walk=(nodes,ctx)=>{for(const n of nodes??[]){
  if(n.type!=='element')continue;
  // Helmet declares data and author programs; its scripts are behavior this smoke does not exercise.
  if(n.tag==='Helmet'){const scripts=c=>(c??[]).reduce((t,x)=>t+(x.type==='element'?(x.tag==='script')+scripts(x.children):0),0);notExercised.scripts+=scripts(n.children);continue}
  if(n.tag==='script'){notExercised.scripts++;continue}
  const inner={repeated:ctx.repeated||n.tag==='For',conditional:ctx.conditional||n.tag==='__mx_condition'};
  const idValue=attr(n,'id'),id=idValue?.static===true&&typeof idValue.json==='string'?idValue.json:null,kind=DATA[n.tag]??(CONTROLS.has(n.tag)?'control':n.tag==='For'?'loop':'element');
  if(!id&&kind!=='element'&&kind!=='loop')fail(`smoke_unidentified_${kind}:${n.tag}`);
  if(id&&!n.tag.startsWith('__mx_')){
   if(seen.has(id)&&!(ctx.repeated&&seen.get(id).repeated))fail('smoke_duplicate_id:'+id);
   if(!seen.has(id)){
    const textLeaf=(n.children??[]).some(isText),expected=textLeaf?literal(n):null;
    const entry={id,tag:n.tag,kind,repeated:ctx.repeated,conditional:ctx.conditional,textLeaf,...(expected!==null&&norm(expected)?{expectedText:norm(expected)}:{}),...(DATA[n.tag]?{query:attr(n,'data')?.json??null}:{}),...(kind==='control'?{label:literal(n)===null?null:norm(literal(n))}:{})};
    entries.push(entry);seen.set(id,entry);if(kind==='control')notExercised.controls.push(id);if(ctx.conditional)notExercised.conditionalIds++;if(ctx.repeated)notExercised.repeatedIds++;
   }
  }
  if(!OPAQUE.has(n.tag)||n.tag==='svg')walk(n.children,inner);
 }};
 walk(result.analysis?.nodes,{repeated:false,conditional:false});
 if(!entries.length)fail('smoke_no_identified_content');
 const body={format:'migration-smoke-contract-v1',key:{sourceId:key.sourceId,version:key.version},sourceSha256:result.graph.sourceSha256,
  scope:'initial state; authored content, data readiness and control presence on both implementations',entries,notExercised,productionWrites:0,acceptanceClaimed:false};
 return{...body,sha256:hash(JSON.stringify(body))};
}

/** Compare original (source) and converted (target) observations of one state/viewport.
 * failures: the converted page is wrong. exceptions: the original did not render, so nothing was proved.
 * warnings: practical differences a reviewer may accept (layout-only ids, visibility, virtualized row counts). */
export function compareSmoke(contract,source,target){
 if(source?.side!=='source'||target?.side!=='target'||source.contractSha256!==contract.sha256||target.contractSha256!==contract.sha256||source.state!==target.state||JSON.stringify(source.viewport)!==JSON.stringify(target.viewport))fail('smoke_observation_binding');
 const failures=[],exceptions=[],warnings=[],add=(list,id,reason,detail)=>list.push({id,reason,...(detail===undefined?{}:{detail})});
 let checked=0;
 for(const e of contract.entries){
  const s=source.entries[e.id],t=target.entries[e.id];if(!s||!t)fail('smoke_observation_entries');checked++;
  const strict=e.textLeaf||e.kind!=='element'&&e.kind!=='loop';
  if(s.count===0&&!e.repeated&&!e.conditional){add(strict?exceptions:warnings,e.id,'source_missing');continue}
  if(s.count!==t.count){add(strict?failures:warnings,e.id,'count_differs',{source:s.count,target:t.count});continue}
  s.instances.forEach((si,i)=>{const ti=t.instances[i];
   if(si.visible!==ti.visible)add(warnings,e.id,'visibility_differs',{index:i,source:si.visible,target:ti.visible});
   if(e.expectedText!==undefined){if(si.text!==e.expectedText)add(exceptions,e.id,'source_literal_differs',{index:i});if(ti.text!==e.expectedText)add(failures,e.id,'literal_text_differs',{index:i,expected:e.expectedText,target:ti.text})}
   else if(e.textLeaf&&(si.text!==ti.text||si.textLength!==ti.textLength))add(failures,e.id,'text_differs',{index:i,source:si.text,target:ti.text});
   if(e.kind==='control'&&!ti.visible&&si.visible)add(failures,e.id,'control_hidden',{index:i});
   if(!DATA[e.tag])return;
   if(!si.data?.loaded||si.busy){add(exceptions,e.id,'source_data_not_loaded',{index:i});return}
   if(!ti.data?.loaded||ti.busy){add(failures,e.id,'target_data_not_loaded',{index:i,state:ti.data?.state??null});return}
   if(e.kind==='cell'&&si.data.value!==ti.data.value)add(failures,e.id,'cell_value_differs',{index:i,source:si.data.value,target:ti.data.value});
   if(e.kind==='chart'){if(si.data.marks!==ti.data.marks)add(failures,e.id,'chart_marks_differ',{index:i,source:si.data.marks,target:ti.data.marks});else if(JSON.stringify(si.data.labels)!==JSON.stringify(ti.data.labels))add(warnings,e.id,'chart_labels_differ',{index:i})}
   if(e.kind==='table'){if(JSON.stringify(si.data.headers)!==JSON.stringify(ti.data.headers))add(failures,e.id,'table_headers_differ',{index:i,source:si.data.headers,target:ti.data.headers});if(si.data.rows!==ti.data.rows)add(warnings,e.id,'table_rows_differ',{index:i,source:si.data.rows,target:ti.data.rows})}
  });
 }
 if(!source.settled)add(exceptions,null,'source_unsettled',source.pending);if(!target.settled)add(failures,null,'target_unsettled',target.pending);
 const status=exceptions.length?'exception':failures.length?'fail':'pass';
 return{format:'migration-smoke-comparison-v1',key:contract.key,contractSha256:contract.sha256,state:source.state,viewport:source.viewport,status,checked,failures,exceptions,warnings,notExercised:contract.notExercised,productionWrites:0,acceptanceClaimed:false};
}

const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'));
/** Bind a conversion review packet by hash and write contract, self-contained probe and provenance to a new directory. */
export async function prepareSmoke({packetPath,packetSha256,output}){
 const packetBytes=await fs.readFile(packetPath);if(hash(packetBytes)!==packetSha256)fail('smoke_packet_digest');
 const packet=JSON.parse(packetBytes);if(packet.status!=='converted')fail('smoke_unconverted');
 const resultBytes=await fs.readFile(packet.result?.path);if(hash(resultBytes)!==packet.result.sha256)fail('smoke_result_digest');
 const result=JSON.parse(resultBytes);if(result.key?.sourceId!==packet.key?.sourceId||result.key?.version!==packet.key?.version||hash(result.graph?.source??'')!==result.graph?.sourceSha256)fail('smoke_source_binding');
 const contract=buildSmokeContract(result),probeSource=await fs.readFile(fileURLToPath(new URL('./smoke-probe.mjs',import.meta.url)),'utf8');
 await fs.mkdir(output,{mode:0o700});
 const put=async(name,bytes)=>{const p=path.join(output,name);await fs.writeFile(p,bytes,{flag:'wx',mode:0o600});return{path:p,sha256:hash(bytes)}};
 const contractRef=await put('contract.json',JSON.stringify(contract,null,2)+'\n');
 const probeRef=await put('probe.mjs',probeSource+'\nexport const contract='+JSON.stringify(contract)+';\nexport const mountImportedPilot=createSmokeProbe(contract);\n');
 const counts=Object.fromEntries(['element','control','cell','chart','table','diagram','loop'].map(k=>[k,contract.entries.filter(e=>e.kind===k).length]));
 await put('provenance.json',JSON.stringify({format:'migration-smoke-preparation-v1',key:contract.key,packet:{path:path.resolve(packetPath),sha256:packetSha256},result:packet.result,contract:contractRef,probe:probeRef,counts,browserJobs:0,productionWrites:0,acceptanceClaimed:false},null,2)+'\n');
 return{sourceId:contract.key.sourceId,version:contract.key.version,entries:contract.entries.length,counts,contract:contractRef,probe:probeRef};
}

/** Pair each normal source/target observation by state and viewport; regression captures are styling controls only. */
export async function compareDirectories({contractPath,sourceDirectory,targetDirectory}){
 const contract=await readJson(contractPath),list=async(dir,side)=>(await fs.readdir(dir)).filter(n=>n.startsWith(`smoke-${side}-`)&&n.endsWith('-normal.json'));
 const sources=await list(sourceDirectory,'source'),targets=new Set(await list(targetDirectory,'target'));if(!sources.length)fail('smoke_no_observations');
 const comparisons=[];for(const name of sources){const pair=name.replace('smoke-source-','smoke-target-');if(!targets.has(pair))fail('smoke_unpaired_observation:'+name);comparisons.push(compareSmoke(contract,await readJson(path.join(sourceDirectory,name)),await readJson(path.join(targetDirectory,pair))))}
 const status=comparisons.some(c=>c.status==='exception')?'exception':comparisons.some(c=>c.status==='fail')?'fail':'pass';
 return{format:'migration-smoke-result-v1',key:contract.key,contractSha256:contract.sha256,status,comparisons,productionWrites:0,acceptanceClaimed:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[action,...rest]=process.argv.slice(2),args={};for(let i=0;i<rest.length;i+=2)args[rest[i].replace(/^--/,'')]=rest[i+1];
 try{
  if(action==='prepare')console.log(JSON.stringify(await prepareSmoke({packetPath:args.packet,packetSha256:args.sha256,output:args.output})));
  else if(action==='compare'){const value=await compareDirectories({contractPath:args.contract,sourceDirectory:args.source,targetDirectory:args.target});if(args.output)await fs.writeFile(args.output,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:value.status,comparisons:value.comparisons.map(c=>({viewport:c.viewport,status:c.status,failures:c.failures.length,exceptions:c.exceptions.length,warnings:c.warnings.length}))}));process.exitCode=value.status==='pass'?0:value.status==='fail'?1:2}
  else{console.error('usage: smoke.mjs prepare --packet P --sha256 H --output DIR | compare --contract C --source DIR --target DIR [--output FILE]');process.exitCode=64}
 }catch(error){console.error(JSON.stringify({code:error.smokeCode??'smoke_error',message:error.message}));process.exitCode=2}
}
