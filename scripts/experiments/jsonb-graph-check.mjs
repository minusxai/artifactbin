/** Native PostgreSQL guard experiment; uses only the runner's disposable cluster.
 * This checks the graph compiler directly; jsonb-operations-check covers the application writer. */
import assert from 'node:assert/strict';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {createDocumentGraph,graphNodes,graphSource,graphIntegrity} from '../../services/app/lib/story/document-graph.ts';
import {applyOperationsToNodes} from '../../services/app/lib/story/document-operation.ts';
import {prepareGraphPatch} from '../../services/app/lib/story/document-graph-patch.ts';
import {graphPatchSql,graphSourceSql} from '../../services/app/lib/story/document-graph-sql.ts';
const db=await getDb();assert.equal(db.raw().kind,'pg');
try{
 await db.query('CREATE TABLE graph_probe(id int PRIMARY KEY,version int,document jsonb)');
 const base=createDocumentGraph('<main id="root">'+Array.from({length:32},(_,i)=>`<section id="s${i}"><p id="p${i}">Text ${i}</p></section>`).join('')+'</main>',1);
 await db.query('INSERT INTO graph_probe VALUES(1,1,$1::jsonb)',[JSON.stringify(base)]);
 const plan=ops=>prepareGraphPatch(base,createDocumentGraph(applyOperationsToNodes(graphNodes(base),ops),2),1);
 const commit=async patch=>{const sql=graphPatchSql('d.document','d.version',patch,[]);return (await db.query(`UPDATE graph_probe d SET document=${sql.expression},version=d.version+1 WHERE id=1 AND ${sql.guard} RETURNING document,version`,sql.params)).rows[0]??null;};
 const plans=Array.from({length:16},(_,i)=>plan([{kind:'setAttribute',path:[0,i,0],name:'className',value:i%2?'italic':'font-bold'},{kind:'insert',parent:[0,i],index:1,source:`<p id="new${i}">Inserted ${i}</p>`}]));
 const results=await Promise.all(plans.map(commit));assert.ok(results.every(Boolean),'all independently prepared composite edits must commit without replanning');
 let head=(await db.query('SELECT * FROM graph_probe')).rows[0];assert.equal(head.version,17);assert.deepEqual(graphIntegrity(head.document),[]);
 for(let i=0;i<16;i++)assert.ok(graphSource(head.document).includes(`Inserted ${i}`));
 const serialized=(await db.query(`SELECT ${graphSourceSql('document')} AS source FROM graph_probe`)).rows[0].source;assert.equal(serialized,graphSource(head.document));
 console.log('PASS native PostgreSQL: 16 independently prepared structural composites, no retries, exact serialization');
 const overlap=plan([{kind:'setText',path:[0,20,0,0],value:'Concurrent'}]);
 const race=await Promise.all([commit(overlap),commit(overlap)]);assert.equal(race.filter(Boolean).length,1);
 console.log('PASS native PostgreSQL: same-node race has exactly one winner');
 await db.query('UPDATE graph_probe SET document=$1::jsonb,version=1',[JSON.stringify(base)]);
 const absence=prepareGraphPatch(base,createDocumentGraph(applyOperationsToNodes(graphNodes(base),[{kind:'setText',path:[0,0,0,0],value:'Guarded'}]),2),1,{selectors:['use:rows']});
 assert.ok(await commit(plan([{kind:'insert',parent:[0,20],index:1,source:'<DataTable data="$rows" />'}])));
 assert.equal(await commit(absence),null);
 console.log('PASS native PostgreSQL: concurrent newly inserted dependency invalidates absence witness');
 await db.query('UPDATE graph_probe SET document=$1::jsonb,version=1',[JSON.stringify(base)]);
 const dense=plan(Array.from({length:30},(_,index)=>({kind:'insert',parent:[0,0],index:index+1,source:`<p>Dense ${index}</p>`})));
 assert.ok(await commit(plan([{kind:'setText',path:[0,0,0,0],value:'Concurrent longer Unicode 👩 text'}])));
 const merged=await commit(dense);assert.ok(merged);assert.deepEqual(graphIntegrity(merged.document),[]);
 console.log('PASS native PostgreSQL: dense insertion preserves concurrent descendant aggregates');
 console.log((await db.query('SELECT version()')).rows[0].version);
}finally{await resetDb();}
