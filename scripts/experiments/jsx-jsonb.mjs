/** Architecture probe only. No app schema, production writes, or editor changes.
 * Run: npx tsx scripts/experiments/jsx-jsonb.mjs
 * Requires the retained POC commit in git history. Uses fresh in-memory PGLite.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {serializeJsx} from '../../services/app/lib/jsx/serialize.ts';

const POC='6cfe0b1';
const readPoc=path=>execFileSync('git',['show',`${POC}:${path}`],{encoding:'utf8'});
// Execute the actual POC compiler/model without porting either into product code.
const bundle=await build({stdin:{contents:readPoc('services/app/lib/document/sql.ts'),loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'poc-model',setup(builder){builder.onResolve({filter:/^\.\/model$/},()=>({path:'model',namespace:'poc'}));builder.onLoad({filter:/.*/,namespace:'poc'},()=>({contents:readPoc('services/app/lib/document/model.ts'),loader:'ts'}));}}]});
const {compileDocumentOperations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const db=new PGlite();
const results={base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),poc:POC,engine:'PGLite 0.4.6, in-memory, one connection; NOT a multi-writer PostgreSQL benchmark'};
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end'].includes(key)).map(([key,v])=>[key,clean(v)])):value;
function parsed(source){const result=parseJsx(source);assert.equal(result.ok,true,result.error);return result.nodes;}
function normalize(ast){let serial=0;const nodes={};const visit=node=>{const sourceId=node.type==='element'&&!node.control&&node.attributes.find(a=>a.name==='id'&&a.value.static)?.value.json;const id=typeof sourceId==='string'?`source:${sourceId}`:`internal:${++serial}`;assert.ok(!nodes[id]);nodes[id]={...clean(node),...(node.type==='element'?{children:node.children.map(visit)}:{})};return id;};return {schemaVersion:1,roots:ast.map(visit),nodes};}
function restore(doc){const visit=id=>{const node=doc.nodes[id];return {...node,start:0,end:0,...(node.type==='element'?{attributes:node.attributes.map(a=>({...a,start:0,end:0})),children:node.children.map(visit)}:{})};};return doc.roots.map(visit);}
const fixtures=[
 '<section id="page"><p id="p">Hello <strong id="bold">world</strong> 👩🏽‍💻 &amp; friends</p><img id="img" src="/assets/test.png" /></section>',
 '<Helmet><style>{`.card > p { color: red; }`}</style><Value name="count" type="number" default={2}/></Helmet><div id="card" className="card"><p id="value">{$count + 1}</p></div>',
 '<><div id="a" data-options={{z:1,a:[true,null]}}>A</div><div id="b">B</div></>',
 '<section id="conditional">{$show && <p id="visible">Shown</p>}{$show ? <span id="yes">Yes</span> : <span id="no">No</span>}</section>',
 '<Question id="query">{"SELECT * FROM items WHERE price > 10"}</Question><Table id="table" query="query" />',
 '<Iframe id="embed" title="Preview"><div id="inside">Embedded content</div></Iframe>',
];
for(const source of fixtures){const original=parsed(source),doc=normalize(original);const readback=(await db.query('SELECT $1::jsonb AS doc',[JSON.stringify(doc)])).rows[0].doc;assert.deepEqual(clean(parsed(serializeJsx(restore(readback)))),clean(parsed(serializeJsx(original))));}
results.roundtrip={cases:fixtures.length,passed:true,contract:'same canonical parsed JSX after JSONB; not original whitespace or source bytes'};
await db.exec('CREATE TABLE probe (id int PRIMARY KEY, version int NOT NULL, document jsonb NOT NULL); CREATE TABLE receipts (version int PRIMARY KEY, changed text[] NOT NULL, ancestors text[] NOT NULL);');
const document={schemaVersion:1,rootId:'root',nodes:{root:{type:'document',props:{},children:['a','b']},a:{type:'html',tag:'p',props:{},text:'A😀B'},b:{type:'html',tag:'p',props:{},text:'Other'}}};
await db.query('INSERT INTO probe VALUES (1,1,$1::jsonb)',[JSON.stringify(document)]);
async function apply(operations,base,changed,ancestors){
 const compiled=compileDocumentOperations(operations,[base,changed,ancestors]);
 return (await db.query(`WITH eligible AS MATERIALIZED (
 SELECT * FROM probe p WHERE id=1 AND $1<=version
 AND (SELECT count(*) FROM receipts r WHERE r.version>$1 AND r.version<=p.version)=p.version-$1
 AND NOT EXISTS(SELECT 1 FROM receipts r WHERE r.version>$1 AND r.version<=p.version AND (r.changed && $2::text[] OR r.ancestors && $2::text[] OR r.changed && $3::text[]))
 ), input AS (SELECT document FROM eligible), ${compiled.ctes}, updated AS (
 UPDATE probe p SET document=x.document,version=p.version+1 FROM ${compiled.result} x,eligible e WHERE p.id=e.id AND p.version=e.version RETURNING p.version,p.document
 ), logged AS (INSERT INTO receipts SELECT version,$2::text[],$3::text[] FROM updated RETURNING version)
 SELECT u.* FROM updated u JOIN logged l USING(version)`,compiled.params)).rows;
}
const unicode=await apply([{kind:'text',nodeId:'a',path:['text'],start:1,deleteCount:1,text:'🌍'}],1,['a'],['root']);assert.equal(unicode[0].document.nodes.a.text,'A🌍B');
assert.equal((await apply([{kind:'set',nodeId:'b',path:['text'],value:'Sibling'}],1,['b'],['root'])).length,1);
assert.equal((await apply([{kind:'set',nodeId:'a',path:['text'],value:'Conflict'}],1,['a'],['root'])).length,0);
assert.equal((await apply([{kind:'set',nodeId:'root',path:['props','className'],value:'changed'}],1,['root'],[])).length,0);
for(let version=3;version<24;version++)assert.equal((await apply([{kind:'set',nodeId:'a',path:['text'],value:`v${version}`}],version,['a'],['root'])).length,1);
// 23 intervening accepted edits on a; b has no overlap since version 3.
for(let version=24;version<26;version++)await apply([{kind:'set',nodeId:'a',path:['text'],value:`v${version}`}],version,['a'],['root']);
assert.equal((await apply([{kind:'set',nodeId:'b',path:['text'],value:'23 behind'}],3,['b'],['root'])).length,1);
const before=(await db.query('SELECT * FROM probe')).rows;
assert.equal((await apply([{kind:'set',nodeId:'a',path:['text'],value:'must roll back'},{kind:'remove',nodeId:'root',path:['children'],index:99}],27,['a','root'],['root'])).length,0);
assert.deepEqual((await db.query('SELECT * FROM probe')).rows,before);
assert.equal((await db.query('SELECT count(*)::int AS n FROM receipts')).rows[0].n,26);
// Missing ancestry history must reject, never silently accept a stale edit.
await db.query('DELETE FROM receipts WHERE version=10');
assert.equal((await apply([{kind:'set',nodeId:'b',path:['text'],value:'missing history'}],3,['b'],['root'])).length,0);
const chain=Array.from({length:256},(_,i)=>`parent${i}`);
const overlap=async(changed,ancestors,otherChanged,otherAncestors)=>(await db.query('SELECT $1::text[] && $3::text[] OR $2::text[] && $3::text[] OR $1::text[] && $4::text[] AS conflict',[changed,ancestors,otherChanged,otherAncestors])).rows[0].conflict;
assert.equal(await overlap(['leafA'],chain,['leafB'],chain),false);
assert.equal(await overlap(['leafA'],chain,['parent128'],chain.slice(0,128)),true);
assert.equal(await overlap(['parent128'],chain.slice(0,128),['leafA'],chain),true);
results.ancestry={depth:256,siblingsAllowed:true,ancestorAndDescendantRejected:true,recursiveSQL:false};
results.atomic={passed:true,cases:['Unicode code points','stale sibling accepted','same node rejected','ancestor rejected','23 intervening edits','invalid final primitive saves nothing and logs nothing','missing history rejected']};
// Counterexamples: the compiler is NOT a document validator.
const dangling=await apply([{kind:'removeNodes',ids:['b']}],27,['b'],['root']);
assert.equal(dangling.length,1);assert.ok(dangling[0].document.nodes.root.children.includes('b'));assert.equal(dangling[0].document.nodes.b,undefined);
results.validity={danglingReferenceAcceptedByPrimitiveCompiler:true,conclusion:'Needs validated composite operation boundary; SQL JSON validity is insufficient'};
// JSONB key order can reorder a static JSON literal inside JSX source.
const ordered=normalize(parsed('<div id="ordered" data-options={{z:1,a:2}} />'));
const reordered=(await db.query('SELECT $1::jsonb AS doc',[JSON.stringify(ordered)])).rows[0].doc;
results.sourceOrder={before:serializeJsx(restore(ordered)),after:serializeJsx(restore(reordered))};
// Isolate database update costs. No rendering, authorization, history, network or contention.
const timings=[];
for(const count of [100,1000,10000]){
 const nodes=Object.fromEntries(Array.from({length:count},(_,i)=>[`n${i}`,{type:'html',tag:'p',props:{className:'prose'},text:'x'.repeat(160)}]));
 const doc={schemaVersion:1,rootId:'n0',nodes},json=JSON.stringify(doc);
 await db.query('UPDATE probe SET document=$1::jsonb WHERE id=1',[json]);
 const compiled=compileDocumentOperations([{kind:'set',nodeId:'n50',path:['text'],value:'updated'}]);
 const sql=`WITH input AS (SELECT document FROM probe WHERE id=1),${compiled.ctes} UPDATE probe SET document=x.document FROM ${compiled.result} x WHERE id=1`;
 const measure=async(fn)=>{const samples=[];for(let i=0;i<12;i++){const t=performance.now();await fn();if(i>=2)samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return +samples[Math.floor(samples.length/2)].toFixed(2);};
 const patchMs=await measure(()=>db.query(sql,compiled.params));
 const replaceMs=await measure(()=>db.query('UPDATE probe SET document=$1::jsonb WHERE id=1',[json]));
 timings.push({nodes:count,bytes:Buffer.byteLength(json),patchParameterBytes:Buffer.byteLength(JSON.stringify(compiled.params)),patchMedianMs:patchMs,replaceMedianMs:replaceMs});
}
results.timings=timings;
console.log(JSON.stringify(results,null,2));await db.close();
