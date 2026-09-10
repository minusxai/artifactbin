import { expect,it } from 'vitest';
import { parseJsx,validateJsx } from '@/lib/jsx';
import { collectRefNameUses } from '../dataflow';
import { keyedRowsError, validRowKey } from '../repeat-identity';
import { publishJsx } from '../jsx-tier';
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
 '<For each={$orders} />',
 '<For each={$orders.map(x=>x)} keyBy="id"/>',
 '<For each={$orders} keyBy="id"><For each={$orders} keyBy="id"/></For>',
 '<For each={$orders} keyBy="id"><button onClick="bad"/></For>',
 '<For each={$orders} keyBy="id"><input value="$shared"/></For>',
 '<For each={$orders} keyBy="id"><Button run="$mutate"/></For>',
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
