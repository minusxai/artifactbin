import {expect,it} from 'vitest';
import type {DocumentOperation} from '@artifactbin/contracts';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/db';
import {createDocumentGraph,graphNodes,graphSource,type DocumentGraph} from '@/lib/story/document-graph';
import {prepareGraphPatch,applyGraphPatch,type GraphPatch} from '@/lib/story/document-graph-patch';
import {graphPatchSql,graphSourceSql,graphReferencesSql} from '@/lib/story/document-graph-sql';
import {applyOperationsToNodes} from '@/lib/story/document-operation';
useAppHarness();
async function setup(){
 const db=await getDb(),graph=createDocumentGraph('<main id="root"><p id="a">Alpha β</p><p id="b">Beta 👩</p></main>',1);
 await db.query('DROP TABLE IF EXISTS graph_sql_test');await db.query('CREATE TEMP TABLE graph_sql_test(document jsonb,version int)');
 await db.query('INSERT INTO graph_sql_test VALUES($1::jsonb,1)',[JSON.stringify(graph)]);
 const commit=async(patch:GraphPatch)=>{const q=graphPatchSql('d.document','d.version',patch,[]);return (await db.query<{document:DocumentGraph}>(`UPDATE graph_sql_test d SET document=${q.expression},version=version+1 WHERE ${q.guard} RETURNING document`,q.params)).rows[0]?.document??null;};
 return {db,graph,commit};
}
const plan=(graph:DocumentGraph,ops:DocumentOperation[])=>prepareGraphPatch(graph,createDocumentGraph(applyOperationsToNodes(graphNodes(graph),ops),2),1);
it('SQL and the model merge independently prepared structural edits identically',async()=>{
 const {graph,commit}=await setup(),a=plan(graph,[{kind:'setAttribute',path:[0,0],name:'title',value:'A'}]),b=plan(graph,[{kind:'setAttribute',path:[0,1],name:'title',value:'B'}]);
 const first=await commit(a);expect(first).toEqual(applyGraphPatch(graph,1,a));
 const both=await commit(b);expect(both).toEqual(applyGraphPatch(first!,2,b));expect(graphSource(both!)).toContain('title="A"');expect(graphSource(both!)).toContain('title="B"');
 expect(await commit(a)).toBeNull();
});
it('SQL preserves composites, checks size and refuses overlapping dependency changes',async()=>{
 const {db,graph,commit}=await setup(),a=plan(graph,[{kind:'insert',parent:[0],index:1,source:'<h2 id="new">New</h2>'},{kind:'move',path:[0,0],parent:[0],index:2},{kind:'setText',path:[0,1,0],value:'Changed'}]);
 expect(await commit(a)).toEqual(applyGraphPatch(graph,1,a));
 expect(await commit(plan(graph,[{kind:'delete',path:[0,1]}]))).toBeNull();
 await db.query('UPDATE graph_sql_test SET document=$1::jsonb,version=1',[JSON.stringify({...graph,bytes:2_000_000})]);
 expect(await commit(plan(graph,[{kind:'insert',parent:[],index:1,source:'<p>Extra</p>'}]))).toBeNull();
});
it.each(['<><p>A &amp; B</p><img src="ref:image" /></>','{$show ? (<p>Yes</p>) : (<p>No</p>)}','<Helmet><style>{`p { color: red; }`}</style></Helmet><p>β 👩</p>'])('SQL reconstructs exact source for histories: %s',async source=>{
 const {db}=await setup(),graph=createDocumentGraph(source,1);
 const result=await db.query<{source:string}>(`SELECT ${graphSourceSql('$1::jsonb')} AS source`,[JSON.stringify(graph)]);
 expect(result.rows[0]!.source).toBe(graphSource(graph));
});
it('SQL rejects newly inserted validation dependencies absent from the planning snapshot',async()=>{
 const {graph,commit}=await setup();
 const next=createDocumentGraph(applyOperationsToNodes(graphNodes(graph),[{kind:'setAttribute',path:[0,0],name:'title',value:'Checked'}]),2);
 const guarded=prepareGraphPatch(graph,next,1,{selectors:['use:rows']});
 expect(await commit(plan(graph,[{kind:'insert',parent:[0,1],index:1,source:'<DataTable data="$rows" />'}]))).not.toBeNull();
 expect(await commit(guarded)).toBeNull();
});

it('derives committed reference metadata in source order without stale snapshot replacement',async()=>{
 const {db}=await setup(),graph=createDocumentGraph('<main><img src="ref:abc123" /><img src="ref:def456" /><img src="ref:abc123" /></main>',1);
 const result=await db.query<{refs:Array<{id:string;kind:string}>}>(`SELECT ${graphReferencesSql('$1::jsonb')} AS refs`,[JSON.stringify(graph)]);
 expect(result.rows[0]!.refs).toEqual([{id:'abc123',kind:'image'},{id:'def456',kind:'image'}]);
});
