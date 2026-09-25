import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/db';
import {createSemanticDocument,prepareSemanticOperation,applySemanticPlan} from '@/lib/story/document-semantic';
import {semanticOperationSql} from '@/lib/story/document-semantic-sql';
import {decodeDocument,type SemanticDocument} from '@/lib/story/document-codec';
import {publishJsx} from '@/lib/story/jsx-tier';
useAppHarness();
const context={loadRef:async()=>null};
async function setup(){
 const published=await publishJsx({},'<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>',context);if(published instanceof Response)throw new Error(await published.text());
 const base={id:'test',version:1,document:createSemanticDocument(published.source!,1),meta:published.meta},db=await getDb();
 await db.query('DROP TABLE IF EXISTS semantic_sql_test');
 await db.query('CREATE TEMP TABLE semantic_sql_test(id text PRIMARY KEY,document jsonb,version int,meta jsonb)');
 await db.query('INSERT INTO semantic_sql_test VALUES($1,$2::jsonb,1,$3::jsonb)',[base.id,JSON.stringify(base.document),JSON.stringify(base.meta)]);return {base,db};
}
it('SQL composes the same guarded structural transformation as the admission model',async()=>{
 const {base,db}=await setup(),token=await prepareSemanticOperation(base,[{kind:'insert',parent:[0],index:1,source:'<h2>Inserted</h2>'},{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],context);
 if(token instanceof Response)throw new Error(await token.text());
 const plan=semanticOperationSql('d.document','d.version','d.meta',token,[]);
 const result=await db.query<{document:SemanticDocument}>(`UPDATE semantic_sql_test d SET document=${plan.expression},version=version+1 WHERE ${plan.guard} RETURNING document`,plan.params);
 expect(result.rows[0]!.document).toEqual(applySemanticPlan(base.document,1,token));
 expect(decodeDocument(result.rows[0]!.document)).toContain('Inserted');
 expect((await db.query(`UPDATE semantic_sql_test d SET document=${plan.expression} WHERE ${plan.guard} RETURNING id`,plan.params)).rows).toHaveLength(0);
});
it('SQL preserves concurrent independent Unicode prose and refuses a consumed-leaf change',async()=>{
 const {base,db}=await setup(),token=await prepareSemanticOperation(base,[{kind:'delete',path:[0,0]}],context);if(token instanceof Response)throw new Error(await token.text());
 const beta=Object.keys(base.document.prose).find(k=>base.document.prose[k]!.value==='Beta')!,current=structuredClone(base.document);
 Object.assign(current.prose[beta]!,{value:'Long β 👩',source:'Long β 👩',units:9,bytes:12,revision:2});current.bytes+=8;
 await db.query('UPDATE semantic_sql_test SET document=$1::jsonb,version=2',[JSON.stringify(current)]);
 const sql=semanticOperationSql('d.document','d.version','d.meta',token,[]);
 const result=await db.query<{document:SemanticDocument}>(`UPDATE semantic_sql_test d SET document=${sql.expression},version=version+1 WHERE ${sql.guard} RETURNING document`,sql.params);
 expect(result.rows[0]!.document).toEqual(applySemanticPlan(current,2,token));
 const alpha=Object.keys(current.prose).find(k=>current.prose[k]!.value==='Alpha')!;current.prose[alpha]!.revision=2;
 await db.query('UPDATE semantic_sql_test SET document=$1::jsonb,version=2',[JSON.stringify(current)]);
 expect((await db.query(`UPDATE semantic_sql_test d SET document=${sql.expression} WHERE ${sql.guard} RETURNING id`,sql.params)).rows).toHaveLength(0);
});
it('fails closed on metadata drift, oversized results, and unknown admission',async()=>{
 const {base,db}=await setup(),token=await prepareSemanticOperation(base,[{kind:'insert',parent:[],index:1,source:'<p>Added</p>'}],context);if(token instanceof Response)throw new Error(await token.text());
 expect(()=>semanticOperationSql('document','version','meta',{} as never,[])).toThrow();
 const sql=semanticOperationSql('d.document','d.version','d.meta',token,[]);
 await db.query("UPDATE semantic_sql_test SET meta=meta||'{\"theme\":\"changed\"}'::jsonb");
 expect((await db.query(`UPDATE semantic_sql_test d SET document=${sql.expression} WHERE ${sql.guard} RETURNING id`,sql.params)).rows).toHaveLength(0);
 await db.query("UPDATE semantic_sql_test SET meta=$1::jsonb,document=jsonb_set(document,'{bytes}','2000000')",[JSON.stringify(base.meta)]);
 expect((await db.query(`UPDATE semantic_sql_test d SET document=${sql.expression} WHERE ${sql.guard} RETURNING id`,sql.params)).rows).toHaveLength(0);
});
