// Bounded prototype, not a drop-in fetch/XHR polyfill or product implementation.
// node scripts/planning/iframe-assets-bridge.mjs [chromium|firefox|webkit]
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const CDN='https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js';
const selected=process.argv[2]??'chromium';assert({chromium,firefox,webkit}[selected]);
const response=await fetch(CDN,{redirect:'error',signal:AbortSignal.timeout(15000)});assert(response.ok);
const chunks=[];let count=0;for await(const chunk of response.body){count+=chunk.length;assert(count<=2_000_000);chunks.push(chunk);}
const bundle=Buffer.concat(chunks),hash=createHash('sha256').update(bundle).digest('hex');
const asset='http://127.0.0.1:7023',main='http://127.0.0.1:7022',cached=`${asset}/assets/${hash}.js`;
const hits=[];
const server=createServer((req,res)=>{
  hits.push({url:req.url,method:req.method,origin:req.headers.origin??null});
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(req.url===`/assets/${hash}.js`){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url==='/assets/module.js'){res.setHeader('Content-Type','text/javascript');res.end('export const answer=42;');}
  else{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(7023,'127.0.0.1',resolve));
const literal=value=>JSON.stringify(value).replaceAll('<','\\u003c');
// Serialized into the opaque child's first script, BEFORE author code loads.
function install(){
  const nativeFetch=fetch.bind(window),NativeXHR=XMLHttpRequest;
  const bad=()=>new DOMException('Only declared anonymous asynchronous GET assets are supported','SecurityError');
  addEventListener('message',function initialize(event){
    if(event.source!==parent||event.data!=='initialize-assets'||event.ports.length!==1)return;
    removeEventListener('message',initialize);
    const port=event.ports[0],pending=new Map();let sequence=0;
    port.onmessage=event=>{const message=event.data,wait=pending.get(message?.id);if(!wait)return;pending.delete(message.id);clearTimeout(wait.timer);message.ok?wait.resolve(message.url):wait.reject(bad());};
    const resolve=url=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Asset resolution timed out'));},2000);pending.set(id,{resolve,reject,timer});port.postMessage({id,type:'resolve',url,method:'GET',credentials:'omit'});});
    window.fetch=async(input,options={})=>{
      const request=input instanceof Request?input:null;
      const method=String(options.method??request?.method??'GET').toUpperCase();
      const credentials=options.credentials??request?.credentials??'omit';
      if(method!=='GET'||!['omit','same-origin'].includes(credentials)||options.body||request?.body||[...new Headers(options.headers??request?.headers)].length)throw bad();
      const url=await resolve(request?request.url:String(input));
      return nativeFetch(url,{method:'GET',credentials:'omit',redirect:'error',signal:options.signal??request?.signal});
    };
    window.XMLHttpRequest=class extends NativeXHR{
      open(method,url,async=true,user,password){if(String(method).toUpperCase()!=='GET'||!async||user!==undefined||password!==undefined)throw bad();this.assetUrl=String(url);this.generation=(this.generation??0)+1;}
      setRequestHeader(){throw bad();}
      send(body){if(body!=null||this.withCredentials||!this.assetUrl)throw bad();const generation=this.generation;resolve(this.assetUrl).then(url=>{if(generation!==this.generation)return;super.open('GET',url,true);super.send();},()=>this.dispatchEvent(new ProgressEvent('error')));}
      abort(){this.generation=(this.generation??0)+1;super.abort();}
    };
    // No port/native-fetch handle is exposed to author code.
    window.dispatchEvent(new Event('assets-ready'));
  });
  parent.postMessage('asset-bootstrap-ready','*');
}
const author=`addEventListener('assets-ready',async()=>{
const original=${literal(CDN)},unknown='https://example.com/account',result={};
let replayPorts=0;addEventListener('message',event=>{replayPorts+=event.ports.length;});parent.postMessage('asset-bootstrap-ready','*');
const check=async(fn)=>{try{return {ok:true,value:await fn()};}catch(error){return {ok:false,error:error.name};}};
result.fetch=await check(async()=>{const r=await fetch(original);return {status:r.status,url:r.url,bytes:(await r.text()).length};});
result.request=await check(async()=>{const r=await fetch(new Request(original,{credentials:'omit'}));return (await r.text()).length;});
result.defaultRequest=await check(async()=>{const r=await fetch(new Request(original));return (await r.text()).length;});
result.cachedRequest=await check(async()=>{const r=await fetch(${literal(cached)});return (await r.text()).length;});
const xhr=(url,credentials=false)=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();try{x.open('GET',url);x.withCredentials=credentials;x.onload=()=>resolve({status:x.status,bytes:x.responseText.length,responseURL:x.responseURL});x.onerror=()=>reject(new Error('xhr rejected'));x.send();}catch(error){reject(error);}});
result.xhr=await check(()=>xhr(original));
result.post=await check(()=>fetch(original,{method:'POST'}));
result.credentials=await check(()=>fetch(original,{credentials:'include'}));
result.headers=await check(()=>fetch(original,{headers:{Authorization:'Bearer forbidden'}}));
result.unknown=await check(()=>fetch(unknown));
result.xhrUnknown=await check(()=>xhr(unknown));
result.xhrCredentials=await check(()=>xhr(original,true));
result.xhrPost=await check(()=>{const x=new XMLHttpRequest();x.open('POST',original);});
result.xhrSync=await check(()=>{const x=new XMLHttpRequest();x.open('GET',original,false);});
result.module=await check(async()=>{const m=await import(${literal(asset+'/assets/module.js')});return m.answer;});
result.bootstrapReplay={ok:replayPorts===0,value:replayPorts};
parent.postMessage({type:'author-result',result},'*');
});`;
const child=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' ${asset};connect-src ${asset};frame-src 'none';worker-src 'none';form-action 'none';base-uri 'none'"><script>(${install.toString()})();</script><script>${author}</script>`;
const host=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',`default-src 'none';script-src 'unsafe-inline' ${asset};connect-src ${asset};frame-src 'none'`);
  res.end(`<!doctype html><script>
  const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.srcdoc=${literal(child)};
  const manifest=new Map([[${literal(CDN)},${literal(cached)}],[${literal(cached)},${literal(cached)}]]);window.requests=[];window.result=null;let initialized=false;
  const resolve=message=>message?.type==='resolve'&&message.method==='GET'&&message.credentials==='omit'&&typeof message.id==='number'&&manifest.has(message.url)?{id:message.id,ok:true,url:manifest.get(message.url)}:{id:message?.id,ok:false};
  window.resolverTests=[resolve({id:1,type:'resolve',url:${literal(CDN)},method:'POST',credentials:'omit'}),resolve({id:2,type:'resolve',url:'https://example.com/account',method:'GET',credentials:'omit'}),resolve({id:3,type:'resolve',url:${literal(CDN)},method:'GET',credentials:'include'})];
  addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;if(event.data==='asset-bootstrap-ready'&&!initialized){initialized=true;const channel=new MessageChannel();channel.port1.onmessage=e=>{window.requests.push(e.data);channel.port1.postMessage(resolve(e.data));};frame.contentWindow.postMessage('initialize-assets','*',[channel.port2]);}else if(event.data?.type==='author-result')window.result=event.data.result;});
  document.documentElement.append(frame);
  </script>`);
});
await new Promise(resolve=>host.listen(7022,'127.0.0.1',resolve));
const browser=await {chromium,firefox,webkit}[selected].launch();
try{
  const page=await browser.newPage();await page.goto(main);await page.waitForFunction(()=>window.result,null,{timeout:20000});
  const state=await page.evaluate(()=>({result:window.result,requests:window.requests,resolverTests:window.resolverTests}));
  for(const name of ['fetch','request','defaultRequest','cachedRequest','xhr','module','bootstrapReplay'])assert(state.result[name].ok,JSON.stringify(state));
  assert.equal(state.result.module.value,42);
  for(const name of ['post','credentials','headers','unknown','xhrUnknown','xhrCredentials','xhrPost','xhrSync'])assert(!state.result[name].ok,name);
  assert(state.resolverTests.every(result=>!result.ok));
  assert(hits.every(hit=>hit.method==='GET'&&[new URL(cached).pathname,'/assets/module.js'].includes(hit.url)));
  assert(state.requests.some(request=>request.url==='https://example.com/account'),'unknown URL reaches manifest resolver and is refused, never fetched');
  console.log(JSON.stringify({engine:selected,browserVersion:browser.version(),bundle:{url:CDN,hash,bytes:bundle.length},state,hits,limits:['Prototype supports async anonymous GET assets only, not full fetch/XHR semantics.','XHR open/readyState/header/timeout behavior differs while async resolution happens; synchronous requests deliberately refused.','Default same-origin requests are normalized to credentials:omit; include is rejected. response.url/responseURL name cached URL, not original.','CSP and public/read-only asset hosting are the security boundary; JavaScript wrappers alone are not tamper-proof isolation.','The MessagePort resolves a fixed manifest only; it is not a general URL importer or arbitrary API proxy.','Positive self-contained ESM42 test is local; CDN Three fixture is classic0.160.1 and not a version recommendation.']},null,2));
}finally{await browser.close();await Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>server.close(resolve))]);}
