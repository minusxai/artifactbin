/** Exercises the downloaded-cell gate's assertions without browsers, servers or gate mutations. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const source=readFileSync(new URL('../gates/gate-live-cells.mjs',import.meta.url),'utf8');
const start=source.indexOf("  await section('a downloaded copy works offline:");
const end=source.indexOf('\n} finally {',start);
const run=new Function('env',`return (async()=>{const {section,stored,fetch,BASE,pageId,token,check,path,os,stamp,writeFileSync,browser,pathToFileURL,until,FIELD,rmSync}=env;${source.slice(start,end)}})()`);
const saved='Fix the signup bug alpha-A bravo-B unsaved-B early-D';
async function assertions(overrides={}) {
 const {value=saved,readonly=true,error=false,network=false}=overrides;
 const checks=[];
 const field={getAttribute:async()=> 'readonly',evaluate:async()=>readonly,inputValue:async()=>value};
 const handlers={};
 const page={on:(name,fn)=>{handlers[name]=fn;},goto:async()=>{
  if(error)handlers.pageerror(new Error('offline script failure'));
  if(network)handlers.request({url:()=> 'https://example.com/request'});
 },locator:()=>field};
 await run({section:async(_name,fn)=>fn(),stored:async()=>saved,
  fetch:async()=>({ok:true,status:200,text:async()=>'<script data-af="collab"></script>'}),
  BASE:'http://localhost',pageId:'test',token:'mxmx_test_token',check:(ok,message)=>checks.push({ok,message}),
  path:{join:()=>'/tmp/test.html'},os:{tmpdir:()=>'/tmp'},stamp:'test',writeFileSync:()=>{},
  browser:{newContext:async()=>({newPage:async()=>page,close:async()=>{}})},
  pathToFileURL:()=>({href:'file:///tmp/test.html'}),until:async(read)=>read(),FIELD:'textarea',rmSync:()=>{}});
 return checks.filter(({ok})=>!ok).map(({message})=>message);
}
it('accepts exactly the final saved snapshot as the offline read-only cell value',async()=>{
 expect(await assertions()).toEqual([]);
});
it.each(['Offline default','Fix the login bug',`${saved} corrupted`])('rejects a missing, stale or corrupted snapshot: %s',async value=>{
 expect(await assertions({value})).not.toEqual([]);
});
it.each([{readonly:false},{error:true},{network:true}])('continues to reject offline contract violations: %j',async violation=>{
 expect(await assertions(violation)).not.toEqual([]);
});
