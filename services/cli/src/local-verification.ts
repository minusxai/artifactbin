/**
 * WHAT `afbin validate` CHECKED, AND ONLY THAT. A document's queries are compiled and dry-run here, in
 * this process, over the workspace's own copies of what they import (the compiler, SQLite engine and
 * dataset readers preview and export use), and every chart bound to a query is checked against that
 * query's result columns. A check that could not run — a dataset with no local copy, a query that runs
 * inside a connected database — is reported as not run, by name. The server's own checks (refs it alone
 * can resolve, the Vega-Lite structure check, write policies) are named as not run: `--remote` adds them.
 *
 * It once printed "1 query dry-run against the published dataset" for a file that was never published
 * and whose SQL did not parse; preview then failed with the syntax error validate should have caught.
 */
import {compileWithLoader,dataflowOf,refName,validateMarkupStructure,validateVizAgainstColumns,type CompiledDataflow,type DatasetColumn,type JsxNode} from '../../app/lib/cli-toolkit';
import type {Row} from '@artifactbin/contracts';
import {declaredRefs,runLocal} from './local-dataflow';
import {localInputReferences,readLocalDataset} from './preview/local-inputs';
import {CliError} from './errors';
import {inspectWorkspace,type Workspace} from './workspace';

export interface LocalDiagnostic {code:string;message:string;fix?:string}
export interface VerifiedDocument {path:string;title:string|null;queries:string[];charts:number;checks:string[];writes?:string[]}

const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;
const SERVER_CHECKS='server checks not run; afbin validate --remote adds them';

/** Every `<Chart data="$q" viz={…}>` in the body: the query it binds and its static viz, when it has one. */
function questions(nodes:JsxNode[],out:Array<{query:string|null;viz:Record<string,unknown>|null}>=[]){
 for(const node of nodes){
  if(node.type!=='element')continue;
  if(node.tag==='Chart'){
   const data=node.attributes.find(attr=>attr.name==='data')?.value,viz=node.attributes.find(attr=>attr.name==='viz')?.value;
   const json=viz?.static?viz.json:null;
   out.push({query:data?.static?refName(data.json):null,viz:json&&typeof json==='object'&&!Array.isArray(json)?json as Record<string,unknown>:null});
  }
  questions(node.children,out);
 }
 return out;
}

/** Verify each named document whose markup is already valid; diagnostics are keyed by path. */
export async function verifyLocalDocuments(workspace:Workspace,paths:string[]):Promise<{verified:VerifiedDocument[];diagnostics:Map<string,LocalDiagnostic[]>}>{
 const verified:VerifiedDocument[]=[],diagnostics=new Map<string,LocalDiagnostic[]>();
 let inputs:Record<string,string>|undefined;
 for(const file of await inspectWorkspace(workspace,paths)){
  if(!file.document||!file.bytes)continue;
  const {split}=validateMarkupStructure(file.document.body);if(!split)continue;
  const flow=dataflowOf(split.content),charts=questions(split.body);
  const queries=split.content.queries.map(query=>query.name),writes=(split.content.mutations??[]).map(mutation=>mutation.name);
  const checks=['markup validated'],problems:LocalDiagnostic[]=[];
  let compiled:CompiledDataflow|undefined;
  if(queries.length||writes.length){
   inputs??=await localInputReferences(workspace);
   const tables=new Map<string,{rows:Row[];columns:DatasetColumn[]}|undefined>();
   const table=async(ref:string)=>{
    if(!tables.has(ref))tables.set(ref,inputs![ref]?await readLocalDataset(workspace.root,inputs![ref]!,ref):undefined);
    return tables.get(ref);
   };
   const missing:string[]=[];
   try{for(const ref of declaredRefs(flow))if(!await table(ref))missing.push(ref);}
   catch(error){problems.push({code:error instanceof CliError?error.code:'invalid_dataset',message:error instanceof Error?error.message:String(error)});}
   if(problems.length){/* The unreadable dataset is the diagnostic; nothing below can run. */}
   else if(missing.length){
    if(queries.length)checks.push(`${plural(queries.length,'query','queries')} not run: ${missing.length===1?`dataset ${missing[0]} has`:`datasets ${missing.join(', ')} have`} no local copy (afbin pull ${missing.join(' ')})`);
   }else{
    const result=await compileWithLoader(flow,async ref=>{const found=await table(ref);return found?{kind:'dataset',tables:[{name:'rows',columns:found.columns}]}:null;});
    if(!result.ok)problems.push(...result.errors.map(error=>({code:'invalid_query',message:error.message,fix:'Correct the SQL in that <Query>; afbin help data shows the supported SQL.'})));
    else{
     compiled=result.compiled;
     const local=compiled.queries.filter(query=>query.engine==='sqlite').map(query=>query.name),remote=compiled.queries.filter(query=>query.engine!=='sqlite').map(query=>query.name);
     if(local.length){
      const state=await runLocal(compiled,table,{values:{},only:local,limit:1});
      const failed=local.filter(name=>state.errors[name]);
      problems.push(...failed.map(name=>({code:'query_failed',message:`<Query name="${name}">: ${state.errors[name]}`,fix:'Correct the SQL in that <Query>; afbin query <file> --name <query> runs it alone.'})));
      if(!failed.length)checks.push(`${plural(local.length,'query','queries')} ran locally against workspace data`);
     }
     if(remote.length)checks.push(`${plural(remote.length,'query','queries')} not run: ${remote.join(', ')} ${remote.length===1?'runs':'run'} inside a connected database`);
    }
   }
  }
  if(!problems.length&&charts.length){
   const columns=new Map(compiled?.queries.map(query=>[query.name,query.columns])??[]);
   let checked=0,unchecked=0;
   for(const chart of charts){
    const kind=chart.viz?.kind,bound=chart.query?columns.get(chart.query):undefined;
    if(!chart.viz||!bound||kind!=='vega-lite'&&kind!=='vega'){unchecked++;continue;}
    checked++;
    problems.push(...validateVizAgainstColumns(chart.viz,bound,`query $${chart.query}`).map(message=>({code:'invalid_chart',message,fix:'Use a column the query returns, or return that column from the query.'})));
   }
   if(checked&&!problems.length)checks.push(`${plural(checked,'chart','charts')} checked against local query columns`);
   if(unchecked)checks.push(`${plural(unchecked,'chart','charts')} not checked: ${compiled?'no static Vega spec bound to a local query':unchecked===1?'its query did not run':'their queries did not run'}`);
  }
  if(writes.length)checks.push(`${plural(writes.length,'write','writes')} declared, not run`);
  checks.push(SERVER_CHECKS);
  if(problems.length)diagnostics.set(file.path,problems);
  else verified.push({path:file.path,title:split.content.title??file.document.metadata.title??null,queries,charts:charts.length,...(writes.length?{writes}:{}),checks});
 }
 return {verified,diagnostics};
}
