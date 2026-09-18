import { expect,it } from 'vitest';
import { parseJsx,validateJsx } from '@/lib/jsx';
import { collectRefNameUses } from '../dataflow';
import { keyedRowsError, validRowKey } from '../repeat-identity';
import { publishJsx } from '../jsx-tier';
import { renderDoc } from '@/lib/skills';
import { stampNodeIds } from '../node-ids';
const source='<For id="orders" each={$orders} keyBy="order_id"><p id="customer">{$_row.customer}</p></For>';
function nodes(source:string){const p=parseJsx(source);if(!p.ok)throw new Error(p.error);return p.nodes;}
it('validates For as inert table dependency and preserves source identity through save/load',()=>{
 expect(validateJsx(nodes(source),{components:['For']})).toEqual([]);
 expect(collectRefNameUses(nodes(source))).toMatchObject([{name:'orders',expects:'table'}]);
 const saved=stampNodeIds(source);const loaded=stampNodeIds(saved.source,{previousSource:saved.source});
 expect(loaded.source).toBe(saved.source);expect(loaded.ids).toEqual(saved.ids);
});
it.each([
 '<For each={$orders} keyBy="" />',
 '<For each={$orders} keyBy={12} />',
 '<For each={$orders} keyBy={$field} />',
 '<For each={$orders.map(x=>x)} keyBy="id"/>',
 '<For each={$orders} keyBy="id"><For each={$orders} keyBy="id"/></For>',
 '<For each={$orders} keyBy="id"><button onClick="bad"/></For>',
 '<For each={$orders} keyBy="id"><input value="$shared"/></For>',
 '<For each={$orders} keyBy="id"><DataTable data="$orders"/></For>',
 '<For each={$orders} keyBy="id"><a href="javascript:alert(1)"/></For>',
])('rejects malformed or active repeat markup %s',(source)=>{expect(validateJsx(nodes(source),{components:['For']})).not.toEqual([])});

it('passes the real publish door with an inline table and rejects scalar iteration',async()=>{
 const good=await publishJsx({},'<Helmet><Value name="orders" type="table" value={[{order_id:"a",customer:"Alice"}]}/></Helmet>'+source);
 if(good instanceof Response) throw new Error(await good.text());
 const bad=await publishJsx({},'<Helmet><Value name="orders" type="string" default="oops"/></Helmet>'+source);
 expect(bad).toBeInstanceOf(Response);expect((bad as Response).status).toBe(400);
});

it('uses the persistence key grammar for render-time validation, including empty keys',()=>{
 expect(validRowKey('')).toBe(true);
 expect(validRowKey('x'.repeat(256))).toBe(true);
 for(const key of ['x'.repeat(257),'a\nb',Infinity,NaN]) {
   expect(validRowKey(key)).toBe(false);
   expect(keyedRowsError([{id:key}],'id')).not.toBeNull();
 }
});

it('publishes an unkeyed For and preserves its table dependency',async()=>{
 const source='<For id="orders" each={$orders}><p id="name">{$_row.name}</p></For>';
 expect(validateJsx(nodes(source),{components:['For']})).toEqual([]);
 expect(collectRefNameUses(nodes(source))).toMatchObject([{name:'orders',expects:'table'}]);
 const published=await publishJsx({},'<Helmet><Value name="orders" type="table" value={[{name:"Alice"}]}/></Helmet>'+source);
 if(published instanceof Response)throw new Error(await published.text());
});


it.each(['For','DataTable'])('publishes row mutation buttons in %s and rejects missing keys',async(kind)=>{
 const helmet='<Helmet><Value name="tasks" type="table" value={[{id:1,done:false}]}/><Mutation name="complete">{`update tasks set done=true where id=$_row.id`}</Mutation></Helmet>';
 const body=kind==='For' ? '<For each={$tasks} keyBy="id"><Button run="$complete">Complete</Button></For>' : '<DataTable data="$tasks" rowKey="id"><Column col="id"><Button run="$complete">Complete</Button></Column></DataTable>';
 const good=await publishJsx({},helmet+body);
 if(good instanceof Response) throw new Error(await good.text());
 const bad=await publishJsx({},helmet+body.replace(/ (keyBy|rowKey)="id"/,''));
 expect(bad).toBeInstanceOf(Response);
 expect((bad as Response).status).toBe(400);
});

it('teaches row buttons in both shipped references',()=>{
 for(const name of ['markup-repeat','markup-editing']) {
  const doc=renderDoc(`artifactbin/references/${name}.md`,'https://example.test');
  expect(doc).toContain('<Button run="$complete">');
  expect(doc).toContain('click');
 }
});

it('teaches dataset image strings, missing covers and the separate media permission boundary',()=>{
 const doc=renderDoc('artifactbin/references/markup-repeat.md','https://example.test');
 expect(doc).toContain('src="$_row.cover_ref"');
 expect(doc).toContain('No photograph available');
 expect(doc).toContain('does not grant access');
 expect(doc).toContain('fewer than 10');
 expect(doc).toContain('not a platform limit');
});

it('accepts image row bindings only in a declared row scope and keeps braced JS rejected',async()=>{
 for(const body of ['<img src="$_row.cover_ref"/>','<For each={$books}><img src="$_row.missing"/></For>','<For each={$books}><img src={$_row.cover_ref}/></For>']){
  const result=await publishJsx({loadRef:async()=>null},'<Helmet><Value name="books" type="table" value={[{cover_ref:"ref:abc123"}]}/></Helmet>'+body);
  expect(result).toBeInstanceOf(Response);expect((result as Response).status).toBe(400);
 }
});
