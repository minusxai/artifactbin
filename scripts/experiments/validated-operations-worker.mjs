/** Native-PG research gate. Run: node scripts/experiments/single-row-benchmark.mjs --validity */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {validateMarkupStructure} from '../../services/app/lib/story/local-validation.ts';
import {extractClassCandidates} from '../../services/app/lib/data/story/story-css.ts';
import {createSql} from '@artifactbin/sql/local';
import {setServices} from '../../services/app/lib/services.ts';
import {MAX_QUERY_ROWS,QUERY_TIMEOUT_MS} from '../../services/app/lib/config.ts';
import {certifyReadFreeSource} from './read-free-prose.mjs';
import {touchedSpanFor} from '../../services/app/lib/story/splice.ts';
import {encodeSource,decodeSource,prepareOperation,commitOperation,certifyPlainDocument,preparePlainText,commitPlainText} from './validated-operations.mjs';

const db=await getDb();assert.equal(db.raw().kind,'pg');
const q=db.query.bind(db);const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.error(`PASS ${name}`);};
const context={loadRef:async id=>id==='image1'?{id,format:'image'}:null};
setServices({sql:createSql({maxRows:MAX_QUERY_ROWS,timeoutMs:QUERY_TIMEOUT_MS})});
try{
 await q('CREATE TABLE validation_documents(id text PRIMARY KEY, version integer NOT NULL, document jsonb NOT NULL, meta jsonb NOT NULL, epoch integer NOT NULL DEFAULT 1, source_bytes integer NOT NULL DEFAULT 0, capabilities jsonb NOT NULL DEFAULT \'{}\', revisions jsonb NOT NULL DEFAULT \'{}\')');
 const base=await publishJsx({},'<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>',context);
 assert.ok(!(base instanceof Response));
 await q('INSERT INTO validation_documents(id,version,document,meta) VALUES($1,1,$2::jsonb,$3::jsonb)',['proof',JSON.stringify(encodeSource(base.source)),JSON.stringify(base.meta)]);
 const head=async()=> (await q('SELECT * FROM validation_documents WHERE id=$1',['proof'])).rows[0];
 const cases=[
  ['ordinary text','<p>Changed &amp; escaped &#123;words&#125;</p>',true],
  ['style class','<p className="bg-red-500">Changed</p>',true],
  ['fragment and literal object order','<><p>{{z:1,a:2}}</p></>',true],
  ['insert/reorder/delete blocks','<section><h2>New</h2><p>Beta</p></section>',true],
  ['managed iframe','<Iframe><p style="color:red">Inside</p><script>{`const x = 1;`}</script></Iframe>',true],
  ['invalid managed script','<Iframe><script>{`const = broken`}</script></Iframe>',false],
  ['duplicate Helmet','<Helmet><title>One</title></Helmet><Helmet><title>Two</title></Helmet>',false],
  ['script outside boundary','<p>Text</p><script>{`alert(1)`}</script>',false],
  ['event handler','<p onClick="alert(1)">Text</p>',false],
  ['inline style','<p style="color:red">Text</p>',false],
  ['javascript URL','<a href="javascript:alert(1)">Text</a>',false],
  ['unknown component','<NotAComponent />',false],
  ['unbound expression','<p>{$missing}</p>',false],
  ['duplicate declaration','<Helmet><Value name="x" type="string" default="a"/><Value name="x" type="string" default="b"/></Helmet><p>Text</p>',false],
  ['row scope','<p>{$_row.name}</p>',false],
  ['missing reference','<img src="ref:missing" />',false],
  ['wrong reference kind','<File src="ref:image1" />',false],
  ['readable image reference','<img src="ref:image1" />',true],
  ['malformed JSX','<p>Not closed',false],
  ['SQL valid against actual local table','<Helmet><Value name="items" type="table" value={[{"name":"A"}]} /><Query name="q">{`select name from items`}</Query></Helmet><p>Data</p>',true],
  ['SQL unknown column','<Helmet><Value name="items" type="table" value={[{"name":"A"}]} /><Query name="q">{`select missing from items`}</Query></Helmet><p>Data</p>',false],
  ['query dependency cycle','<Helmet><Query name="a">{`select * from b`}</Query><Query name="b">{`select * from a`}</Query></Helmet><p>Data</p>',false],
  ['invalid Mermaid code','<Mermaid code={123} />',false],
  ['invalid flow Grid height','<Grid mode="flow"><GridItem minHeight={-1}><p>Text</p></GridItem></Grid>',false],
 ];
 for(const [name,source,valid] of cases)await check(`publish parity: ${name}`,async()=>{
  const before=await head();const expected=await publishJsx({},source,context);
  assert.equal(!(expected instanceof Response),valid,`${name}: ${expected instanceof Response?await expected.clone().text():expected.source}`);
  const op=await prepareOperation(before,source,context);
  assert.equal(!(op instanceof Response),valid);
  if(op instanceof Response){assert.deepEqual(await op.json(),await expected.json());assert.deepEqual(await head(),before);return;}
  assert.equal((await commitOperation(q,'proof',op)).length,1);
  const after=await head();assert.equal(decodeSource(after.document),expected.source);assert.deepEqual(after.meta,expected.meta);
  const republished=await publishJsx({},decodeSource(after.document),context);assert.ok(!(republished instanceof Response));
  assert.equal(republished.source,expected.source);assert.equal(after.version,before.version+1);
 });
 await check('JSONB object-key reordering preserves authored literal order',async()=>{
  const src='<p>{{"z":1,"a":{"z":2,"a":3}}}</p>';
  const encoded=(await q('SELECT $1::jsonb AS document',[JSON.stringify(encodeSource(src))])).rows[0].document;
  assert.equal(decodeSource(encoded),src);
 });
 await check('individually valid edits can jointly invalidate a declaration',async()=>{
  const declaration='<Helmet><Value name="x" type="string" default="hello" /></Helmet>';
  for(const source of [declaration+'<p>Ready</p>','<p>Ready</p>',declaration+'<p>{$x}</p>'])assert.equal(validateMarkupStructure(source).errors.length,0);
  assert.ok(validateMarkupStructure('<p>{$x}</p>').errors.length>0);
 });
 await check('stale prepared operation cannot commit after a conflicting operation',async()=>{
  const before=await head();const a=await prepareOperation(before,'<p>First</p>',context);const b=await prepareOperation(before,'<p>Second</p>',context);
  assert.ok(!(a instanceof Response)&&!(b instanceof Response));
  assert.equal((await commitOperation(q,'proof',a)).length,1);
  assert.equal((await commitOperation(q,'proof',b)).length,0);
  assert.equal(decodeSource((await head()).document),'<p>First</p>');
 });
 await check('plain text can alter the compiled CSS dependency set',async()=>{
  assert.notDeepEqual(extractClassCandidates('<p>Plain</p>'),extractClassCandidates('<p>className="bg-red-500"</p>'));
  const a=await publishJsx({},'<p>Plain</p>',context);const b=await publishJsx({},'<p>className="bg-red-500"</p>',context);
  assert.ok(!(a instanceof Response)&&!(b instanceof Response));assert.notEqual(a.meta.compiledCss,b.meta.compiledCss);
 });
 await check('source byte cap is enforced by candidate admission',async()=>{
  const before=await head();const op=await prepareOperation(before,'<p>'+'x'.repeat(2_000_000)+'</p>',context);
  assert.ok(op instanceof Response);assert.equal(op.status,413);assert.deepEqual(await head(),before);
 });
 await check('unvalidated and mutated certificates cannot cross the commit boundary',async()=>{
  await assert.rejects(commitOperation(q,'proof',{version:1,patches:[],meta:{}}),/Unvalidated/);
  const op=await prepareOperation(await head(),'<p>Valid</p>',context);
  assert.throws(()=>{op.patches=[{path:[],value:{invalid:true}}];},TypeError);
 });
 await check('publication metadata options are still checked at their owning boundary',async()=>{
  for(const body of [{theme:'not-a-theme'},{template:'not-a-template'},{colorMode:'not-a-mode'}])assert.ok(await publishJsx(body,'<p>Text</p>',context) instanceof Response);
 });
 await check('preview-only validation cannot issue a publication certificate',async()=>{
  await assert.rejects(prepareOperation(await head(),'<img src="ref:missing"/>',{}),/reference loader/);
 });
 await check('read-free source certificates preserve the existing touched-span contract',async()=>{
  const source='<section>Top<p id="a">First <strong>bold</strong> last</p><p id="b">Second &amp; final</p></section>';
  const capabilities=certifyReadFreeSource(source);assert.ok(Object.keys(capabilities).length>=5);
  for(const cap of Object.values(capabilities).filter(x=>typeof x==='object'))assert.deepEqual(touchedSpanFor(source,{start:cap.start,removed:source.slice(cap.start,cap.end),inserted:''}),{start:cap.spanStart,end:cap.spanEnd});
  for(const source of ['<p>/people/example</p>','<p>Emoji 🎉</p>','<p>className="bg-red-500"</p>','<Iframe><p>Text</p></Iframe>'])assert.deepEqual(certifyReadFreeSource(source),{});
 });
 const plain=encodeSource(base.source);const paths=certifyPlainDocument(plain);assert.equal(paths.length,2);
 const capabilities=Object.fromEntries(paths.map(p=>[JSON.stringify(p),true]));
 const createPlain=async(id,source=base.source)=>q('INSERT INTO validation_documents(id,version,document,meta,source_bytes,capabilities) VALUES($1,1,$2::jsonb,$3::jsonb,$4,$5::jsonb)',[id,JSON.stringify(encodeSource(source)),JSON.stringify(base.meta),Buffer.byteLength(source),JSON.stringify(capabilities)]);
 await createPlain('plain');
 const plainOp=(i,oldText,newText,baseVersion=1,epoch=1)=>preparePlainText({path:paths[i],oldText,newText,baseVersion,epoch});
 await check('independent stale prose edits and 23-version lag preserve complete publish validity',async()=>{
  let old='Alpha';
  for(let i=0;i<23;i++){const next=`Edit ${i}`;assert.equal((await commitPlainText(q,'plain',plainOp(0,old,next,i+1))).length,1);old=next;}
  assert.equal((await commitPlainText(q,'plain',plainOp(1,'Beta','Independent after 23 writes'))).length,1);
  const stored=(await q('SELECT * FROM validation_documents WHERE id=\'plain\'')).rows[0];
  const source=decodeSource(stored.document);const valid=await publishJsx({},source,context);
  assert.ok(!(valid instanceof Response));assert.equal(valid.source,source);assert.deepEqual(valid.meta,stored.meta);assert.equal(stored.source_bytes,Buffer.byteLength(source));
 });
 await check('same-node ABA, missing paths, future bases and special source are refused',async()=>{
  await createPlain('aba');
  assert.equal((await commitPlainText(q,'aba',plainOp(0,'Alpha','Other'))).length,1);
  assert.equal((await commitPlainText(q,'aba',plainOp(0,'Other','Alpha',2))).length,1);
  assert.equal((await commitPlainText(q,'aba',plainOp(0,'Alpha','Stale'))).length,0);
  assert.equal((await commitPlainText(q,'aba',plainOp(1,'Beta','Future',99))).length,0);
  const nonexistent=preparePlainText({path:['roots','99','value'],oldText:'',newText:'Orphan',baseVersion:3,epoch:1});
  assert.equal((await commitPlainText(q,'aba',nonexistent)).length,0);
  for(const text of ['className="bg-red-500"','data-design="tw"','style="position:fixed"','STYLE = "color:red"','\0','\ud800','\r\n'])assert.throws(()=>plainOp(1,'Beta',text));
  const normalized=await prepareOperation(await head(),'<p>Windows\r\nnewline</p>',context);assert.ok(!(normalized instanceof Response));
  assert.equal((await commitOperation(q,'proof',normalized)).length,1);assert.equal(decodeSource((await head()).document),'<p>Windows\nnewline</p>');
  for(const source of ['<Helmet><title>Hi</title></Helmet><p>Text</p>','<Iframe><p>Text</p></Iframe>','<p>{$x}</p>'])assert.equal(certifyPlainDocument(encodeSource(source)),null);
 });
 await check('prose escaping and variable lengths preserve validation, bytes and CSS',async()=>{
  await createPlain('unicode');let old='Alpha';let version=1;
  const values=['<script>alert(1)</script>','{$missing}', '"quoted" & ampersands', 'こんにちは 👩🏽‍💻 café', '', 'line one\nline two','\r','\t','\u2028','&nbsp; &amp;', ...Array.from({length:30},(_,i)=>`Sample ${i}: ${'🎉 & < > { } '.repeat(i%7)}`)];
  for(const value of values){assert.equal((await commitPlainText(q,'unicode',plainOp(0,old,value,version))).length,1);old=value;version++;
   const row=(await q('SELECT * FROM validation_documents WHERE id=\'unicode\'')).rows[0];const source=decodeSource(row.document);const prepared=await publishJsx({},source,context);
   assert.ok(!(prepared instanceof Response));assert.equal(prepared.source,source);assert.deepEqual(prepared.meta,row.meta);assert.equal(row.source_bytes,Buffer.byteLength(source));
  }
 });
 await check('concurrent growth cannot exceed the document byte cap',async()=>{
  const source=base.source.replace('Alpha','x'.repeat(1_999_800));await createPlain('limit',source);
  const old='x'.repeat(1_999_800);const remaining=2_000_000-Buffer.byteLength(source);assert.ok(remaining>0);
  const grow=Math.floor(remaining*.75);
  const attempts=await Promise.all([commitPlainText(q,'limit',plainOp(0,old,old+'a'.repeat(grow))),commitPlainText(q,'limit',plainOp(1,'Beta','Beta'+'b'.repeat(grow)))]);
  assert.equal(attempts.filter(a=>a.length===1).length,1);
  const row=(await q('SELECT * FROM validation_documents WHERE id=\'limit\'')).rows[0];assert.ok(row.source_bytes<=2_000_000);assert.equal(row.source_bytes,Buffer.byteLength(decodeSource(row.document)));
 });
 await check('general edits invalidate old prose capabilities; prose edits invalidate stale general certificates',async()=>{
  await createPlain('mixed');
  const before=(await q('SELECT * FROM validation_documents WHERE id=\'mixed\'')).rows[0];
  const general=await prepareOperation(before,'<Iframe><p>New context</p></Iframe>',context);
  assert.equal((await commitOperation(q,'mixed',general)).length,1);
  assert.equal((await commitPlainText(q,'mixed',plainOp(0,'Alpha','Wrong context'))).length,0);
  const stored=(await q('SELECT * FROM validation_documents WHERE id=\'mixed\'')).rows[0];assert.deepEqual(stored.capabilities,{});
  await createPlain('mixed2');
  const other=(await q('SELECT * FROM validation_documents WHERE id=\'mixed2\'')).rows[0];
  const stale=await prepareOperation(other,'<p>Replacement</p>',context);
  assert.equal((await commitPlainText(q,'mixed2',plainOp(0,'Alpha','New prose'))).length,1);
  assert.equal((await commitOperation(q,'mixed2',stale)).length,0);
  await assert.rejects(commitOperation(q,'mixed',stale),/another artifact/);
 });
 await check('guard removal is detected by the conflict assertion (negative control)',async()=>{
  await createPlain('fault');
  const before=(await q('SELECT * FROM validation_documents WHERE id=\'fault\'')).rows[0];
  const a=await prepareOperation(before,'<p>Winner</p>',context);const b=await prepareOperation(before,'<p>Loser</p>',context);
  assert.equal((await commitOperation(q,'fault',a)).length,1);
  const brokenQuery=(sql,params)=>q(sql.replace('AND version=$2','AND $2::int >= 0'),params);
  const lostUpdate=await commitOperation(brokenQuery,'fault',b);
  assert.throws(()=>assert.equal(lostUpdate.length,0),assert.AssertionError);
 });
 await check('guards use the newest locked row, including dependency epoch',async()=>{
  await createPlain('locked');const client=await db.raw().pool.connect();
  const pending=[];
  try{
   await client.query('BEGIN');
   const before=(await client.query('SELECT * FROM validation_documents WHERE id=\'locked\'')).rows[0];
   const general=await prepareOperation(before,'<Iframe><p>Changed context</p></Iframe>',context);
   await commitOperation(client.query.bind(client),'locked',general);
   pending.push(commitPlainText(q,'locked',plainOp(1,'Beta','Must reject')));
   for(let i=0;;i++){
    const waiting=(await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE validation_documents SET%'")).rows[0].n;
    if(waiting)break;assert.ok(i<100,'writer must reach held row lock');await new Promise(resolve=>setTimeout(resolve,10));
   }
   await client.query('COMMIT');assert.equal((await pending[0]).length,0);
  }finally{await client.query('ROLLBACK');client.release();await Promise.allSettled(pending);}
 });
 writeFileSync('/tmp/artifact-validity-results.json',JSON.stringify({engine:'native PostgreSQL',checks:results},null,2));
 console.log(`${results.length} validity checks passed`);
}finally{await resetDb();}
