/** Counterexamples against the real publisher, persisted in a disposable native PG table.
 * These are proof obligations, NOT a replacement validator. A JSONB mutation succeeding is
 * deliberately distinguished from a document passing publication. No product row is touched.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {encodeSource,decodeSource,diff} from './validated-operations.mjs';

const table='<Value name="items" type="table" value={[{"name":"A","amount":2}]} />';
const value='<Value name="label" type="string" default="A" />';
const head=contents=>`<Helmet>${contents}</Helmet>`;
const query=sql=>`<Query name="q">{\`${sql}\`}</Query>`;
const p='<p id="p">Ready</p>';

export async function auditOperationContracts(q,context){
 const evidence=[];
 await q('CREATE TABLE operation_audit(id text PRIMARY KEY, document jsonb NOT NULL)');
 const publish=source=>publishJsx({},source,context);
 const valid=async source=>{const result=await publish(source);assert.ok(!(result instanceof Response),result instanceof Response?await result.text():source);return result;};
 // Each input is syntactically valid JSX: the JSON representation and the mutation both
 // succeed. The failure is the semantic contract, not malformed JSON or malformed SQL.
 const cases=[
  ['text: escaped row template','<p>Safe</p>','<p>&#123;$_row.name&#125;</p>','row scope'],
  ['attribute: event handler',p,'<p id="p" onClick="run()">Ready</p>','element security'],
  ['attribute: unsafe URL','<a href="https://example.com">Link</a>','<a href="javascript:run()">Link</a>','URL scheme'],
  ['attribute: inline style',p,'<p id="p" style="color:red">Ready</p>','style policy'],
  ['attribute: local image path','<img src="ref:image1"/>','<img src="picture.png"/>','resource resolution'],
  ['attribute: missing image','<img src="ref:image1"/>','<img src="ref:missing"/>','reference existence and kind'],
  ['tag: unknown component',p,'<Invented>Ready</Invented>','registry'],
  ['component: invalid Mermaid payload','<Mermaid code="graph TD; A-->B"/>','<Mermaid code={123}/>','component payload grammar'],
  ['component: invalid chart envelope',head(table)+'<Question data="$items" viz={{kind:"single_value",yCols:["amount"]}}/>',head(table)+'<Question data="$items" viz={{mark:"line",encoding:{}}}/>','visualisation contract'],
  ['parent: Grid mode changes child contract','<Grid mode="positioned"><GridItem x={0} y={0} w={6} h={2}><p>Card</p></GridItem></Grid>','<Grid mode="flow"><GridItem x={0} y={0} w={6} h={2}><p>Card</p></GridItem></Grid>','parent and children'],
  ['move: row expression outside scope',head(table)+'<For each={$items} keyBy="name"><p>{$_row.name}</p></For>',head(table)+'<p>{$_row.name}</p>','old and new ancestry'],
  ['move: executable node outside iframe','<Iframe><script>{`const x = 1;`}</script></Iframe>','<script>{`const x = 1;`}</script>','execution boundary'],
  ['payload: iframe JavaScript syntax','<Iframe><script>{`const x = 1;`}</script></Iframe>','<Iframe><script>{`const = broken;`}</script></Iframe>','JavaScript compilation'],
  ['insert: second Helmet',head('<title>A</title>')+p,head('<title>A</title>')+head('<title>B</title>')+p,'document singleton'],
  ['insert: duplicate declaration',head(value)+p,head(value+value)+p,'declaration namespace'],
  ['delete: referenced declaration',head(value)+'<p>{$label}</p>','<p>{$label}</p>','reverse reference dependency'],
  ['rename: declaration without consumers',head(value)+'<p>{$label}</p>',head(value.replace('label','other'))+'<p>{$label}</p>','all name consumers'],
  ['expression: undeclared reference',head(value)+p,head(value)+'<p>{$missing}</p>','declaration type and existence'],
  ['SQL: unknown result column',head(table+query('select name from items'))+p,head(table+query('select absent from items'))+p,'SQL planner and table schema'],
  ['schema: remove a queried column',head(table+query('select amount from items'))+p,head('<Value name="items" type="table" value={[{"name":"A"}]}/>'+query('select amount from items'))+p,'reverse SQL dependency'],
  ['SQL: introduce dependency cycle',head('<Query name="a">{`select 1 as n`}</Query><Query name="b">{`select * from a`}</Query>')+p,head('<Query name="a">{`select * from b`}</Query><Query name="b">{`select * from a`}</Query>')+p,'entire affected query graph'],
  ['font: invalid family name',head('<meta name="font-body" content="Lora"/>')+p,head('<meta name="font-body" content="bad; font"/>')+p,'font vocabulary'],
  ['script: forbidden closing token',head('<script>{`const x = 1`}</script>')+p,head('<script>{`const x = "</script"`}</script>')+p,'script boundary'],
 ];
 for(const [name,beforeSource,afterSource,dependency] of cases){
  const before=await valid(beforeSource),beforeAst=encodeSource(before.source),afterAst=encodeSource(afterSource);
  await q('INSERT INTO operation_audit VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document',[name,JSON.stringify(beforeAst)]);
  const params=[name];let expression='document';const patches=diff(beforeAst,afterAst);
  assert.ok(patches.length);
  for(const patch of patches){params.push(patch.path,JSON.stringify(patch.value));expression=patch.path.length?`jsonb_set(${expression},$${params.length-1}::text[],$${params.length}::jsonb,false)`:`$${params.length}::jsonb`;}
  const stored=(await q(`UPDATE operation_audit SET document=${expression} WHERE id=$1 RETURNING document`,params)).rows[0];
  assert.deepEqual(stored.document,afterAst);
  const result=await publish(decodeSource(stored.document));assert.ok(result instanceof Response,`${name} must be a semantic refusal`);
  evidence.push({name,dependency,jsonbUpdateAccepted:true,publishStatus:result.status,refusal:await result.json()});
 }
 // Non-ancestor edges matter even when BOTH requests passed complete validation against base.
 const a=head(value)+p,b=p,c=head(value)+'<p>{$label}</p>',combined='<p>{$label}</p>';
 for(const source of [a,b,c])await valid(source);
 assert.ok(await publish(combined) instanceof Response);
 evidence.push({name:'concurrent declaration deletion and distant consumer insertion',eachCandidateValid:true,combinedInvalid:true,requiredGuard:'declaration label and its reverse-use set; ancestor IDs alone cannot detect this'});
 // Composites must be admitted as a unit: requiring all internal states to be valid
 // unnecessarily rejects a valid rename, regardless of the storage representation.
 const renamed=head(value.replace('label','other'))+'<p>{$other}</p>';
 await valid(renamed);assert.ok(await publish(head(value.replace('label','other'))+'<p>{$label}</p>') instanceof Response);
 evidence.push({name:'atomic declaration + consumer rename',finalValid:true,intermediateInvalid:true,requiredGuard:'validate the composite final state, then apply all patches in one statement'});
 // Canonicalization is observable behavior, not merely a boolean validation predicate.
 const nested=await valid('<p id="outer"><span><div>Block</div></span></p>');
 assert.ok(nested.source.startsWith('<div id="outer">'));
 evidence.push({name:'insert descendant block normalizes ancestor paragraph',canonicalSource:nested.source,requiredGuard:'ancestor normalization is part of the write set'});
 writeFileSync('/tmp/artifact-operation-contract-audit.json',JSON.stringify({engine:'native PostgreSQL',evidence},null,2));
 return evidence;
}
