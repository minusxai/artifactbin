import {expect,it} from 'vitest';
import {publishBundleDependencies,type BundlePublisher} from '../execute';
import {planPublicationBundle} from '../plan';
const file=(path:string,text=path,contentType='image/svg+xml')=>({path,contentType,base64:Buffer.from(text).toString('base64')});
const plan=(count:number)=>planPublicationBundle(Array.from({length:count},(_,i)=>`<img src="${i}.svg">`).join(''),{entryPath:'index.html',files:Array.from({length:count},(_,i)=>file(`${i}.svg`))});
const saved=(index:number)=>({id:`ASSET${index}`,revision:'1',address:`/assets/${index}`});
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('bounds independent writes at four and orders receipts by plan rather than completion',async()=>{
 let active=0,peak=0;const release:Array<()=>void>=[],started:number[]=[];
 const publishing=publishBundleDependencies(plan(9),'bounded_publication',{reuse:async()=>'',create:async input=>{started.push(input.reservationIndex);peak=Math.max(peak,++active);await new Promise<void>(resolve=>release.push(resolve));active--;return saved(input.reservationIndex);}});
 await turn();expect(started).toEqual([0,1,2,3]);
 for(let wave=0;wave<3;wave++){release.splice(0).reverse().forEach(resolve=>resolve());await turn();}
 const result=await publishing;expect(peak).toBe(4);expect(result.receipts.map(r=>r.path)).toEqual(Array.from({length:9},(_,i)=>`${i}.svg`));
});
it('waits for the entire failed wave and returns successful receipts for retry with stable slots and keys',async()=>{
 const snapshot=plan(6),started:number[]=[],keys=new Map<number,string>();let finished=false;
 const publisher:BundlePublisher={reuse:async(_path,mapping)=>`/assets/${mapping.id.slice(5)}`,create:async input=>{started.push(input.reservationIndex);keys.set(input.reservationIndex,input.key);if(input.reservationIndex===1)throw Error('stage failed');if(input.reservationIndex===2){await turn();finished=true;}return saved(input.reservationIndex);}};
 const failure=await publishBundleDependencies(snapshot,'retry_publication',publisher).catch(error=>error);
 expect(finished).toBe(true);expect(started).toEqual([0,1,2,3]);expect(failure.cause.message).toBe('stage failed');expect(failure.receipts.map((r:{path:string})=>r.path)).toEqual(['0.svg','2.svg','3.svg']);
 const mappings=Object.fromEntries(failure.receipts.map((r:{path:string})=>[r.path,r]));started.length=0;
 const result=await publishBundleDependencies(snapshot,'retry_publication',{...publisher,create:async input=>{started.push(input.reservationIndex);if(keys.has(input.reservationIndex))expect(input.key).toBe(keys.get(input.reservationIndex));return saved(input.reservationIndex);}},mappings);
 expect(started).toEqual([1,4,5]);expect(result.receipts.map(r=>r.path)).toEqual(Array.from({length:6},(_,i)=>`${i}.svg`));
});
it('rewrites parents only after children complete and coalesces concurrent identical bytes',async()=>{
 const snapshot=planPublicationBundle('<link href="main.css"><img src="copy.svg">',{entryPath:'index.html',files:[file('main.css','body{background:url(child.svg)}','text/css'),file('child.svg','same'),file('copy.svg','same')]});
 const writes:string[]=[];
 const result=await publishBundleDependencies(snapshot,'nested_publication',{reuse:async()=>'',create:async input=>{writes.push(input.path);await turn();if(input.path==='main.css')expect(Buffer.from(input.base64,'base64').toString()).toContain('/assets/0');return saved(input.reservationIndex);}});
 expect(writes).toEqual(['child.svg','main.css']);expect(result.receipts.map(r=>r.id)).toEqual(['ASSET0','ASSET2','ASSET0']);
});
it('reports the first failure in plan order after delayed concurrent failures settle',async()=>{
 const failure=await publishBundleDependencies(plan(5),'ordered_failure',{reuse:async()=>'',create:async input=>{if(input.reservationIndex===0){await turn();throw Error('first');}throw Error('later');}}).catch(error=>error);
 expect(failure.cause.message).toBe('first');expect(failure.receipts).toEqual([]);
});
it('settles mapped conditional updates and retains their state and original identities',async()=>{
 const snapshot=plan(3),mappings=Object.fromEntries(snapshot.dependencies.map((dependency,index)=>[dependency.path,{kind:'asset' as const,id:`ORIGINAL${index}`,revision:'7',state:'prior',sha256:'changed'}]));
 let completed=false;
 const failure=await publishBundleDependencies(snapshot,'conditional_publication',{reuse:async()=>{throw Error('must update');},create:async()=>{throw Error('must retain identity');},update:async(input,mapping)=>{expect(mapping.id).toBe(`ORIGINAL${input.reservationIndex}`);if(input.reservationIndex===1)throw Error('version conflict');await turn();completed=true;return {...saved(input.reservationIndex),id:mapping.id,revision:'8',state:'next'};}},mappings).catch(error=>error);
 expect(completed).toBe(true);expect(failure.cause.message).toBe('version conflict');expect(failure.receipts.map((r:{id:string;revision:string;state:string})=>[r.id,r.revision,r.state])).toEqual([['ORIGINAL0','8','next'],['ORIGINAL2','8','next']]);
});

it('retains reserved slots when retry mappings omit completed file bytes',async()=>{
 const first=plan(3),slots=new Map<string,number>();
 const failure=await publishBundleDependencies(first,'omitted_retry',{reuse:async()=>'',create:async input=>{slots.set(input.path,input.reservationIndex);if(input.path==='1.svg')throw Error('retry');return saved(input.reservationIndex);}}).catch(error=>error);
 const mappings=Object.fromEntries(failure.receipts.map((receipt:{path:string})=>[receipt.path,receipt]));
 const retry=planPublicationBundle(first.html,{entryPath:'index.html',files:[file('1.svg')],mappings});
 const result=await publishBundleDependencies(retry,'omitted_retry',{reuse:async(_path,mapping)=>'/assets/'+mapping.id,create:async input=>{expect(input.reservationIndex).toBe(slots.get(input.path));return saved(input.reservationIndex);}},mappings);
 expect(result.receipts.map(receipt=>receipt.id).sort()).toEqual(['ASSET0','ASSET1','ASSET2']);
});
