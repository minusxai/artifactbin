import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {verifyNativeRuntimeObjects} from '../verify-objects';
import type {NativeRuntimeObjectVerificationPorts} from '../contracts';
const inputs=(count:number)=>Array.from({length:count},(_,i)=>({path:`${i}.bin`,id:`Asset${i}`,revision:'1',expected:Buffer.from(`bytes${i}`),contentType:'application/octet-stream'}));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const owned=(id:string)=>{const expected=Buffer.from(`bytes${id.slice(5)}`);return {format:'file',version:1,meta:{objectKey:id,sha256:sha(expected),bytes:expected.length,contentType:'application/octet-stream'}};};
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('verifies four independent dependencies concurrently while retaining publication order',async()=>{
 const release:Array<()=>void>=[],started:string[]=[];let active=0,peak=0;
 const pending=verifyNativeRuntimeObjects(inputs(9),{readOwned:async id=>owned(id),readObject:async key=>{started.push(key);peak=Math.max(peak,++active);await new Promise<void>(resolve=>release.push(resolve));active--;return Buffer.from(`bytes${key.slice(5)}`);}});
 await turn();expect(started).toEqual(['Asset0','Asset1','Asset2','Asset3']);
 for(let wave=0;wave<3;wave++){release.splice(0).reverse().forEach(resolve=>resolve());await turn();}
 expect((await pending).map(x=>x.path)).toEqual(inputs(9).map(x=>x.path));expect(peak).toBe(4);
});
it('settles every started check before rejecting and does not start the next wave',async()=>{
 const started:string[]=[];let finished=false;
 const pending=verifyNativeRuntimeObjects(inputs(6),{readOwned:async id=>{started.push(id);return id==='Asset1'?null:owned(id);},readObject:async key=>{await turn();if(key==='Asset3')finished=true;return Buffer.from(`bytes${key.slice(5)}`);}});
 await expect(pending).rejects.toThrow('native_runtime_invalid');expect(finished).toBe(true);expect(started).toEqual(['Asset0','Asset1','Asset2','Asset3']);
});
it.each(['owner','format','version','sha','size','type','bytes','missing-object'])('rejects a dependency with invalid %s without bypassing ownership or full bytes',async mode=>{
 let reads=0;const ports:NativeRuntimeObjectVerificationPorts={readOwned:async id=>{if(mode==='owner')return null;const row=owned(id);if(mode==='format')row.format='html';if(mode==='version')row.version=2;if(mode==='sha')row.meta.sha256='0'.repeat(64);if(mode==='size')row.meta.bytes++;if(mode==='type')row.meta.contentType='text/plain';return row;},readObject:async()=>{reads++;if(mode==='missing-object')throw Error('missing');return Buffer.from(mode==='bytes'?'bad000':'bytes0');}};
 await expect(verifyNativeRuntimeObjects(inputs(1),ports)).rejects.toThrow();expect(reads).toBe(['bytes','missing-object'].includes(mode)?1:0);
});
