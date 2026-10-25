import {it,expect} from 'vitest';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {captureBrowserBaseline} from '../lib/component-browser-baseline.mjs';
it('awaits per-state cleanup before context close and next viewport even when real readiness fails',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'capture-cleanup-'));let state=7,index=0;const seen=[],events=[];
 const frame={url:()=> 'http://app.lvh.me/a/Example1',evaluate:async fn=>fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
 const browser={newContext:async()=>{const id=index++;return {newPage:async()=>({on(){},screenshot:async()=>Buffer.from('image')}),close:async()=>events.push('close'+id)};}};
 try{await expect(captureBrowserBaseline({browser,output,implementation:'html',sourceRevision:'a'.repeat(40),themes:['light'],viewports:[{width:1280,height:900},{width:390,height:800}],fixtures:[{id:'page',states:[{id:'booking',actions:[]}]}],mount:async()=>{const id=seen.length;seen.push(state);return {frame,ready:async()=>{state=99;if(id===0)throw Error('original-note-reset-assertion');},cleanup:async()=>{await Promise.resolve();state=7;events.push('cleanup'+id);}};}})).rejects.toThrow('original-note-reset-assertion');
 expect(seen).toEqual([7,7]);expect(events).toEqual(['cleanup0','close0','cleanup1','close1']);const status=JSON.parse(await readFile(path.join(output,'capture-status.json'),'utf8'));expect(status.complete).toBe(false);expect(status.failures.some(f=>f.message.includes('original-note-reset-assertion'))).toBe(true);
 }finally{await rm(output,{recursive:true,force:true});}
});
it('records cleanup failure as incomplete evidence while retaining the original assertion',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'capture-cleanup-error-'));let closed=false,mounts=0;
 const frame={url:()=> 'http://app.lvh.me/a/Example1',evaluate:async()=>({faces:[],used:[],errors:[]})},browser={newContext:async()=>({newPage:async()=>({on(){},screenshot:async()=>Buffer.from('image')}),close:async()=>{closed=true;}})};
 try{await expect(captureBrowserBaseline({browser,output,implementation:'html',sourceRevision:'a'.repeat(40),themes:['light'],viewports:[{width:1280,height:900},{width:390,height:800}],fixtures:[{id:'page',states:[{id:'booking',actions:[]}]}],mount:async()=>{mounts++;return {frame,ready:async()=>{throw Error('real-assertion');},cleanup:async()=>{throw Error('restore-readback-failed');}};}})).rejects.toThrow('real-assertion');expect(closed).toBe(true);expect(mounts).toBe(1);const status=JSON.parse(await readFile(path.join(output,'capture-status.json'),'utf8'));expect(status.complete).toBe(false);expect(status.failures.some(f=>f.phase==='cleanup'&&f.message.includes('restore-readback-failed'))).toBe(true);
 }finally{await rm(output,{recursive:true,force:true});}
});
