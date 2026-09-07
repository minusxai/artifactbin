// Actual protected runtime + actual store, synthetic immutable table producer.
// Run alone: node scripts/planning/managed-product-state.mjs chromium
import {createServer} from 'node:http';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const name=process.argv[2]??'chromium';
const engine={chromium,firefox,webkit}[name];assert(engine);
const source=`
import {startAuthorScript} from './services/app/lib/story-runtime/author-script';
import {managedAuthorDocument} from './services/app/lib/story-runtime/managed-iframe';
import {createDataflowStore} from './services/app/lib/story-runtime/store';
window.benchmark=async(count,rows)=>{
 const store=createDataflowStore({flow:{values:[{kind:'scalar',name:'seq',type:'number',default:0,start:0,end:0}],queries:[]}});
 // Keep the product store, but supply a stable large table alongside its scalars.
 const table={columns:[],rows:Array.from({length:rows},(_,id)=>({id,label:'task-'+id,hours:8}))};
 const state=store.getState.bind(store),listeners=new Set(),subscribe=store.subscribe.bind(store);
 store.getState=()=>({...state(),tables:{large:table}});
 store.subscribe=fn=>{listeners.add(fn);const stop=subscribe(fn);return()=>{listeners.delete(fn);stop();};};
 let messages=0;const seen=new Map(),stops=[],hosts=[];
 const nonce=crypto.randomUUID();
 const receive=e=>{if(e.data?.nonce===nonce&&Number.isInteger(e.data.index)){messages++;seen.set(e.data.index,e.data.seq);}};
 addEventListener('message',receive);
 const wait=async(seq)=>{const start=performance.now();while(seen.size!==count||[...seen.values()].some(n=>n!==seq)){if(performance.now()-start>15000)throw Error('state timeout '+seq);await new Promise(r=>setTimeout(r,1));}};
 try{
  for(let index=0;index<count;index++){
   const host=document.createElement('div');host.style='height:100px;width:200px';document.body.append(host);hosts.push(host);
   const script='const out=document.createElement("output");document.body.append(out);function changed(v){out.textContent=String(v.seq);top.postMessage({nonce:'+JSON.stringify(nonce)+',index:'+index+',seq:v.seq},"*");}changed({seq:mx.params.get("seq")});mx.params.subscribe(["seq"],changed);';
   stops.push(startAuthorScript('',store,document,{host,title:'Measured region',html:'',document:managedAuthorDocument(),scripts:[{type:'classic',source:script}]}));
  }
  await wait(0);const serial=[];
  for(let seq=1;seq<=25;seq++){const begin=performance.now();store.setValue('seq',seq);await wait(seq);if(seq>5)serial.push(performance.now()-begin);}
  const initial=messages,begin=performance.now();for(let seq=26;seq<=125;seq++)store.setValue('seq',seq);await wait(125);
  return{count,rows,serialMs:serial.sort((a,b)=>a-b),burstMs:performance.now()-begin,burstMessages:messages-initial,final:[...seen.values()]};
 }finally{for(const stop of stops)stop();for(const host of hosts)host.remove();removeEventListener('message',receive);if(listeners.size||document.querySelector('iframe'))throw Error('retained runtime subscriptions/frames');}
};`;
const bundled=(await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:'tsconfig.json'})).outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bench.js'?'text/javascript':'text/html');res.end(req.url==='/bench.js'?bundled:'<!doctype html><script src="/bench.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await engine.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const results=[];
 for(const count of [1,4,8])for(const rows of [0,10000]){
  const result=await page.evaluate(({count,rows})=>benchmark(count,rows),{count,rows});
  assert.deepEqual(result.final,Array(count).fill(125));assert.equal(result.burstMessages,count);
  const timings=result.serialMs;results.push({...result,serialMs:{p50:timings[10],p95:timings[19]}});
 }
 // Repeated product mounting and disposal, not fixture-only frame removal.
 for(let i=0;i<30;i++)await page.evaluate(()=>benchmark(1,0));
 console.log(JSON.stringify({engine:name,version:browser.version(),results,extraLifecycleCycles:30,notes:['Actual store/startAuthorScript/bootstrap/wrapper; synthetic fixed table, not database/SSE.','16ms coalescing is intentional; latency ends at child DOM write + parent receipt, not paint.','Lifecycle assertions count product subscriptions and DOM frames, not GPU memory.']},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
