import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createSql} from '@artifactbin/sql/local';
import {setServices} from '../../services/app/lib/services.ts';
import {MAX_QUERY_ROWS,QUERY_TIMEOUT_MS} from '../../services/app/lib/config.ts';
import {createKernel,renderState,planStructure,planProse,fingerprint} from './semantic-kernel.mjs';
import {encodeSource,decodeSource,encodeProseText} from './validated-operations.mjs';
import {auditOperationContracts} from './operation-contract-audit.mjs';
const db=await getDb();assert.equal(db.raw().kind,'pg');const pool=db.raw().pool;
setServices({sql:createSql({maxRows:MAX_QUERY_ROWS,timeoutMs:QUERY_TIMEOUT_MS})});
const context={loadRef:async id=>id==='image1'?{id,format:'image'}:null};
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.error('PASS '+name);};
const slotsOf=row=>{const out=[];const visit=nodes=>nodes.forEach(n=>{if(n.slot)out.push(n.slot);if(n.children)visit(n.children);});visit(row.document.tree.roots);return out;};
let seq=0;
try {
 const kernel=await createKernel(pool,context);
 const make=async(source='<section><p>Alpha</p><p>Beta</p></section>')=>{const result=await kernel.create('case'+(++seq),source);assert.ok(!(result instanceof Response),result instanceof Response?await result.text():source);return result;};
 const assertValid=async row=>{
  const source=renderState(row.document),published=await publishJsx({theme:row.meta.theme,template:row.meta.template,colorMode:row.meta.colorMode},source,context);
  assert.ok(!(published instanceof Response),published instanceof Response?await published.text():source);
  assert.equal(published.source,source);assert.deepEqual(published.meta,row.meta);assert.equal(row.source_bytes,Buffer.byteLength(source));assert.equal(row.semantic_hash,fingerprint(row.document.tree));
 };
 const mutate=async(base,operations)=>{const planned=await planStructure(base,operations,context);assert.ok(!(planned instanceof Response),planned instanceof Response?await planned.text():'');const result=await kernel.commit(base.id,planned);assert.ok(result);await assertValid(result);return result;};
 await check('different paragraphs, variable lengths and Unicode commute from one base',async()=>{
  const row=await make(),slots=slotsOf(row);
  const result=await Promise.all(slots.map((slot,i)=>kernel.text(row.id,{base:row.version,epoch:row.epoch,slot,oldText:row.document.prose[slot].value,newText:`Changed ${i} 🎉 café & < >`})));assert.equal(result.filter(Boolean).length,2);await assertValid(await kernel.read(row.id));
 });
 await check('semantic edit preserves an intervening independent paragraph edit',async()=>{
  const base=await make(),slot=slotsOf(base)[0];
  const plan=await planStructure(base,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'}],context);
  assert.ok(await kernel.text(base.id,{base:1,epoch:1,slot,oldText:'Alpha',newText:'New text, a much longer paragraph 🎉'}));
  const row=await kernel.commit(base.id,plan);assert.ok(row);assert.match(renderState(row.document),/New text, a much longer paragraph 🎉/);await assertValid(row);
 });
 await check('deleted or consumed prose dependencies reject a stale semantic operation',async()=>{
  const base=await make(),slot=slotsOf(base)[0];
  const plan=await planStructure(base,[{kind:'delete',path:['roots','0','children','0']}],context);
  assert.ok(await kernel.text(base.id,{base:1,epoch:1,slot,oldText:'Alpha',newText:'Preserve me'}));assert.equal(await kernel.commit(base.id,plan),null);await assertValid(await kernel.read(base.id));
 });
 await check('every invalid semantic fixture is refused before any write',async()=>{
  await auditOperationContracts(pool.query.bind(pool),context,async({name,beforeSource,afterSource})=>{
   const base=await make(beforeSource),plan=await planStructure(base,[{kind:'replaceDocument',source:afterSource}],context);
   assert.ok(plan instanceof Response,name);assert.deepEqual(await kernel.read(base.id),base);
  });
 });
 const validFixtures=[
  '<Helmet><title>A new title</title><meta name="font-body" content="Lora"/><style>{`.note { color: red; }`}</style><script>{`const greeting = "hello";`}</script></Helmet><div className="note"><p>Styled prose</p></div>',
  '<Iframe><p style="color:red">Inside iframe</p><script>{`const x = 1;`}</script></Iframe><p>Outside</p>',
  '<Helmet><Value name="x" type="string" default="hello"/></Helmet><p>{$x}</p>',
  '<Helmet><Value name="items" type="table" value={[{"name":"A","amount":2}]}/><Query name="q">{`select name, amount from items`}</Query></Helmet><For each={$q} keyBy="name"><p>{$_row.name}</p></For><Question data="$q" viz={{kind:"single_value",yCols:["amount"]}}/>',
  '<Grid mode="positioned"><GridItem x={0} y={0} w={6} h={2}><p>Grid card</p></GridItem></Grid>',
  '<Mermaid code="graph TD; A-->B"/><img src="ref:image1"/><p>Diagram and image</p>',
  '<><p>Fragment</p><p>{{z:1,a:2}}</p></>',
  '<p id="outer"><span><div>Ancestor canonicalization</div></span></p>',
  '<p>className="bg-red-500"</p><p>Scanner-dependent text</p>',
 ];
 for(let i=0;i<validFixtures.length;i++)await check(`full-vocabulary publication parity ${i+1}`,async()=>{
  const base=await make();const row=await mutate(base,[{kind:'replaceDocument',source:validFixtures[i]}]);
  const full=await publishJsx({},validFixtures[i],context);assert.ok(!(full instanceof Response));assert.equal(renderState(row.document),full.source);assert.deepEqual(row.meta,full.meta);
 });
 await check('set/remove attributes, insert, replace, move, delete and composites',async()=>{
  let row=await make();
  row=await mutate(row,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'},{kind:'insert',parent:['roots','0'],index:1,source:'<aside><p>Inserted</p></aside>'}]);
  row=await mutate(row,[{kind:'move',path:['roots','0','children','0'],parent:['roots','0','children','1'],index:1},{kind:'removeAttribute',path:['roots','0'],name:'className'}]);
  assert.match(renderState(row.document),/<aside><p>Inserted<\/p><p>Alpha<\/p><\/aside>/);
  row=await mutate(row,[{kind:'replace',path:['roots','0','children','1'],source:'<h2>Replacement</h2>'},{kind:'delete',path:['roots','0','children','0']}]);
  assert.equal(renderState(row.document),'<section><h2>Replacement</h2></section>');
 });
 await check('rename declaration and consumer admits final state, not invalid intermediate',async()=>{
  const base=await make('<Helmet><Value name="x" type="string" default="hello"/></Helmet><p>{$x}</p>');
  const operations=[{kind:'setAttribute',path:['roots','0','children','0'],name:'name',value:'y'},{kind:'replace',path:['roots','1'],source:'<p>{$y}</p>'}];
  assert.ok(await planStructure(base,[operations[0]],context) instanceof Response);await mutate(base,operations);
 });
 await check('non-ancestor semantic write skew is refused in either order',async()=>{
  for(const reverse of [false,true]){
   const base=await make('<Helmet><Value name="x" type="string" default="hello"/></Helmet><p>Prose</p>');
   const deletion=await planStructure(base,[{kind:'delete',path:['roots','0']}],context);
   const usage=await planStructure(base,[{kind:'replace',path:['roots','1'],source:'<p>{$x}</p>'}],context);
   assert.ok(!(deletion instanceof Response)&&!(usage instanceof Response));
   assert.ok(await kernel.commit(base.id,reverse?usage:deletion));assert.equal(await kernel.commit(base.id,reverse?deletion:usage),null);await assertValid(await kernel.read(base.id));
  }
 });
 await check('23-version lag, same-leaf ABA and stale context',async()=>{
  const base=await make(),[a,b]=slotsOf(base);let row=base;
  for(let i=0;i<23;i++)row=await kernel.text(base.id,{base:row.version,epoch:1,slot:a,oldText:row.document.prose[a].value,newText:i===22?'Alpha':`Round ${i}`});
  assert.ok(await kernel.text(base.id,{base:1,epoch:1,slot:b,oldText:'Beta',newText:'Late independent'}));
  assert.equal(await kernel.text(base.id,{base:1,epoch:1,slot:a,oldText:'Alpha',newText:'Stale ABA'}),null);
  row=await kernel.read(base.id);await mutate(row,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'}]);
  assert.equal(await kernel.text(base.id,{base:row.version,epoch:row.epoch,slot:a,oldText:'Alpha',newText:'Stale context'}),null);
 });
 await check('forged semantic witness, prose context and opaque certificates cannot commit',async()=>{
  const base=await make(),fake=structuredClone(base);fake.document.tree.roots[0].tag='article';
  const plan=await planStructure(fake,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'}],context);assert.equal(await kernel.commit(base.id,plan),null);
  const forged=structuredClone(base),slot=slotsOf(base)[0];forged.document.prose[slot].value='Forged';
  const deletion=await planStructure(forged,[{kind:'delete',path:['roots','0','children','0']}],context);assert.equal(await kernel.commit(base.id,deletion),null);
  await assert.rejects(kernel.commit(base.id,{}),/Unvalidated/);
  const legitimate=await planStructure(base,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'}],context);await assert.rejects(kernel.commit('different',legitimate),/another document/);
 });
 await check('moving prose into an opaque context consumes and validates its actual value',async()=>{
  const base=await make('<div><p>const = invalid;</p></div><Iframe><script>{`const x=1;`}</script></Iframe>');
  // A prose text is moved into a script: the placeholder must NEVER be validated instead.
  const plan=await planStructure(base,[{kind:'delete',path:['roots','1','children','0','children','0']},{kind:'move',path:['roots','0','children','0','children','0'],parent:['roots','1','children','0'],index:0}],context);
  assert.ok(plan instanceof Response);assert.deepEqual(await kernel.read(base.id),base);
 });
 await check('scanner-like opaque content materializes and guards all dependent prose',async()=>{
  const base=await make();const plan=await planStructure(base,[{kind:'insert',parent:[],index:0,source:'<Helmet><script>{`const x = \'className="text-red-500"\';`}</script></Helmet>'}],context);
  assert.ok(!(plan instanceof Response));const row=await kernel.commit(base.id,plan);assert.ok(row);assert.equal(slotsOf(row).length,0);await assertValid(row);
 });
 await check('concurrent growth respects the global byte cap',async()=>{
  const base=await make('<section><p>'+'x'.repeat(1_999_700)+'</p><p>Beta</p></section>'),[a,b]=slotsOf(base);
  const amount=Math.floor((2_000_000-base.source_bytes)*.75);
  const rows=await Promise.all([a,b].map(slot=>kernel.text(base.id,{base:1,epoch:1,slot,oldText:base.document.prose[slot].value,newText:base.document.prose[slot].value+'y'.repeat(amount)})));assert.equal(rows.filter(Boolean).length,1);await assertValid(await kernel.read(base.id));
 });
 await check('row-lock wait rechecks consumed dependencies and preserves independent edits',async()=>{
  const base=await make(),[a,b]=slotsOf(base);const plan=await planStructure(base,[{kind:'delete',path:['roots','0','children','0']}],context);
  const client=await pool.connect();let pending;
  try{
   await client.query('BEGIN');await client.query("UPDATE semantic_documents SET document=jsonb_set(jsonb_set(document,ARRAY['prose',$2,'value'],'\"Changed\"'),ARRAY['prose',$2,'revision'],'2'),version=2 WHERE id=$1",[base.id,a]);
   pending=kernel.commit(base.id,plan);
   for(let i=0;;i++){const waiting=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%UPDATE semantic_documents SET%'")).rows[0].n;if(waiting)break;assert.ok(i<100);await new Promise(r=>setTimeout(r,10));}
   await client.query('COMMIT');assert.equal(await pending,null);
   assert.ok(await kernel.text(base.id,{base:1,epoch:1,slot:b,oldText:'Beta',newText:'Independent'}));
  }finally{await client.query('ROLLBACK');client.release();if(pending)await pending;}
 });

 await check('safe and semantic text routes match the full publisher for adversarial strings',async()=>{
  const values=['', 'line one\nline two', '\r', '\t', 'こんにちは 👩🏽‍💻 café', '<script>alert(1)</script>', '{$missing}', '{$_row.name}', 'className="bg-red-500"', 'STYLE = "position:fixed"', '&nbsp; &amp;', '"quotes" and \u2028', '\ud800'];
  for(const value of values){
   const base=await make('<p>Before</p>');
   const candidate=structuredClone(base.document.tree);delete candidate.roots[0].children[0].slot;candidate.roots[0].children[0].value=value;
   const expected=await publishJsx({},Buffer.from(decodeSource(candidate),'utf8').toString('utf8'),context);
   const planned=await planStructure(base,[{kind:'setText',path:['roots','0','children','0'],value}],context);
   assert.equal(planned instanceof Response,expected instanceof Response,JSON.stringify(value));
   if(!(planned instanceof Response)){const result=await kernel.commit(base.id,planned);assert.ok(result);assert.equal(renderState(result.document),expected.source);await assertValid(result);}
  }
 });

 await check('escaped JSON NUL and surrogate keys/values survive native JSONB losslessly',async()=>{
  const source='<p>{{"null":"\\u0000","surrogate":"\\ud800","\\u0000":{"\\udfff":"nested"}}}</p>';
  const native=(await pool.query('SELECT $1::jsonb document',[JSON.stringify(encodeSource(source))])).rows[0].document;
  assert.equal(decodeSource(native),source);
  const base=await make();const row=await mutate(base,[{kind:'replaceDocument',source}]);assert.equal(renderState(row.document),source);
 });
 await check('literal NUL is refused before writing, like PostgreSQL TEXT',async()=>{
  const base=await make();const planned=await planStructure(base,[{kind:'setText',path:['roots','0','children','0','children','0'],value:'\0'}],context);assert.ok(planned instanceof Response);assert.equal(planned.status,400);
  await assert.rejects(pool.query('SELECT $1::text',['\0']));assert.deepEqual(await kernel.read(base.id),base);
 });
 await check('adjacent text leaves cannot assemble hidden scanner syntax',async()=>{
  const base=await make('<div><p>className</p><p>=&quot;text-red-500&quot;</p></div>');
  const row=await mutate(base,[{kind:'move',path:['roots','0','children','1','children','0'],parent:['roots','0','children','0'],index:1}]);
  assert.equal(slotsOf(row).length,0);await assertValid(row);
 });
 await check('move cycles and unknown operations fail before writing',async()=>{
  const base=await make();await assert.rejects(planStructure(base,[{kind:'move',path:['roots','0'],parent:['roots','0','children','0'],index:0}],context),/cycle/);
  await assert.rejects(planStructure(base,[{kind:'invented',path:['roots','0']}],context),/Unknown operation/);assert.deepEqual(await kernel.read(base.id),base);
 });


 await check('changed external references cannot bypass current publication checks',async()=>{
  let available=true;
  const dynamic={loadRef:async id=>available&&id==='dynamic'?{id,format:'image'}:null};
  const external=await createKernel(pool,dynamic);
  const base=await external.create('external','<div><img src="ref:dynamic"/><p>Alpha</p><p>Beta</p></div>');assert.ok(!(base instanceof Response));assert.equal(base.context_required,true);
  const [a,b]=slotsOf(base),input={slot:a,oldText:'Alpha',newText:'Changed'};
  assert.equal(await external.text(base.id,{base:1,epoch:1,...input}),null);
  available=false;
  assert.ok(await planProse(base,input,dynamic) instanceof Response);
  available=true;
  const first=await planProse(base,input,dynamic),second=await planProse(base,{slot:b,oldText:'Beta',newText:'Also changed'},dynamic);
  assert.ok(!(first instanceof Response)&&!(second instanceof Response));
  assert.ok(await external.preparedText(base.id,first));assert.ok(await external.preparedText(base.id,second));
  const row=await external.read(base.id);assert.match(renderState(row.document),/Changed/);assert.match(renderState(row.document),/Also changed/);
  const valid=await publishJsx({},renderState(row.document),dynamic);assert.ok(!(valid instanceof Response));
 });
 await check('font resolver refusals remain admission failures',async()=>{
  let reject=false;const fonts={...context,resolveFont:async()=>reject?new Response('font unavailable',{status:400}):null};
  const external=await createKernel(pool,fonts);const base=await external.create('fonts','<Helmet><meta name="font-body" content="Lora"/></Helmet><p>Alpha</p>');assert.ok(!(base instanceof Response));assert.equal(base.context_required,true);
  reject=true;assert.ok(await planProse(base,{slot:slotsOf(base)[0],oldText:'Alpha',newText:'Changed'},fonts) instanceof Response);assert.deepEqual(await external.read(base.id),base);
 });
 await check('permission is rechecked by the atomic statement',async()=>{
  const base=await make(),slot=slotsOf(base)[0];const plan=await planStructure(base,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'}],context);
  await pool.query("UPDATE semantic_documents SET owner_id='another_owner' WHERE id=$1",[base.id]);
  assert.equal(await kernel.text(base.id,{base:1,epoch:1,slot,oldText:'Alpha',newText:'Unauthorized'}),null);assert.equal(await kernel.commit(base.id,plan),null);assert.equal(await kernel.read(base.id),undefined);
 });
 await check('typed log replays all accepted text and structural edits exactly',async()=>{
  const initial=await make();let row=initial;const slot=slotsOf(row)[1];
  row=await kernel.text(row.id,{base:row.version,epoch:row.epoch,slot,oldText:'Beta',newText:'Changed & longer 🎉'});
  row=await mutate(row,[{kind:'setAttribute',path:['roots','0'],name:'className',value:'p-4'},{kind:'insert',parent:['roots','0'],index:1,source:'<h2>New heading</h2>'}]);
  row=await mutate(row,[{kind:'delete',path:['roots','0','children','0']}]);
  const doc=structuredClone(initial.document);let meta=initial.meta;
  for(const entry of (await pool.query('SELECT * FROM semantic_edits WHERE id=$1 ORDER BY version',[row.id])).rows){
   const op=entry.operation;
   if(op.kind==='text')doc.prose[op.slot]={value:op.after,bytes:Buffer.byteLength(encodeProseText(op.after)),revision:entry.version};
   else{for(const patch of op.patches){if(!patch.path.length)doc.tree=patch.value;else{const parent=patch.path.slice(0,-1).reduce((node,k)=>node[k],doc.tree);parent[patch.path.at(-1)]=patch.value;}}for(const id of op.removed)delete doc.prose[id];for(const [id,v]of Object.entries(op.fresh))doc.prose[id]={...v,revision:entry.version};meta=op.meta;}
  }
  assert.deepEqual(doc,row.document);assert.deepEqual(meta,row.meta);assert.equal(renderState(doc),renderState(row.document));
  const restored=await mutate(row,[{kind:'replaceDocument',source:renderState(initial.document)}]);assert.equal(renderState(restored.document),renderState(initial.document));
 });

 await check('paragraphs inside kit components and For retain independent prose identities',async()=>{
  const fixtures=[
   '<Card><CardContent><p>Alpha</p><p>Beta</p></CardContent></Card>',
   '<Helmet><Value name="items" type="table" value={[{"name":"A"}]}/></Helmet><For each={$items} keyBy="name"><div><p>Alpha</p><p>Beta</p></div></For>',
   '<><div><p>Alpha</p><p>Beta</p></div></>',
  ];
  for(const source of fixtures){const base=await make(source),slots=slotsOf(base);assert.equal(slots.length,2);const writes=await Promise.all(slots.map(slot=>kernel.text(base.id,{base:1,epoch:1,slot,oldText:base.document.prose[slot].value,newText:'Independent '+base.document.prose[slot].value})));assert.equal(writes.filter(Boolean).length,2);await assertValid(await kernel.read(base.id));}
 });
 await check('a failed log insert rolls back the entire statement',async()=>{
  const base=await make(),slot=slotsOf(base)[0];await pool.query("INSERT INTO semantic_edits VALUES($1,2,'{}')",[base.id]);
  await assert.rejects(kernel.text(base.id,{base:1,epoch:1,slot,oldText:'Alpha',newText:'Never stored'}));assert.deepEqual(await kernel.read(base.id),base);
  assert.equal((await pool.query('SELECT count(*)::int n FROM semantic_history WHERE id=$1',[base.id])).rows[0].n,0);
  await pool.query('DELETE FROM semantic_edits WHERE id=$1',[base.id]);
 });

 await check('existing input repairs remain supported by structural operations',async()=>{
  const source='<Helmet><Query name="q">{\\`select 1 as n\\`}</Query></Helmet><p>Repaired</p>'.replaceAll('\\\\','\\');
  const expected=await publishJsx({},source,context);assert.ok(!(expected instanceof Response));
  const base=await make();const row=await mutate(base,[{kind:'replaceDocument',source}]);assert.equal(renderState(row.document),expected.source);
 });
 await check('projection expansion near 2 MB falls back without losing a valid document',async()=>{
  const source='<div data-note="'+'x'.repeat(1_999_900)+'"><p>A</p><p>B</p></div>';
  const base=await make(source);const row=await mutate(base,[{kind:'setAttribute',path:['roots','0'],name:'title',value:'ok'}]);assert.ok(row.source_bytes<2_000_000);assert.match(renderState(row.document),/title="ok"/);
 });
 await check('history coalesces while each accepted write has an operation log',async()=>{
  const rows=(await pool.query('SELECT id,version FROM semantic_documents')).rows;
  for(const row of rows){const counts=(await pool.query('SELECT (SELECT count(*)::int FROM semantic_history WHERE id=$1) h,(SELECT count(*)::int FROM semantic_edits WHERE id=$1) e',[row.id])).rows[0];assert.ok(counts.h<=counts.e);assert.ok(counts.e===0||counts.h>=1);}
 });
 writeFileSync('/tmp/artifact-semantic-kernel-results.json',JSON.stringify({engine:'native PostgreSQL',checks},null,2));console.log(`${checks.length} semantic kernel checks passed`);
}finally{await resetDb();}
