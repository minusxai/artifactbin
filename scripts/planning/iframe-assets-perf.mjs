// Planning experiment only. No product runtime, automatic bundler, or public writes.
// node scripts/planning/iframe-assets-perf.mjs [chromium|firefox|webkit] [samples=5]
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';

const CDN='https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js';
const selected=process.argv[2]??'chromium', samples=Number(process.argv[3]??5);
assert({chromium,firefox,webkit}[selected]);
assert(Number.isInteger(samples)&&samples>0&&samples<=20);
const downloadedAt=performance.now();
const response=await fetch(CDN,{redirect:'error',signal:AbortSignal.timeout(15000)});
assert(response.ok,`fixed CDN response ${response.status}`);
const chunks=[];let bytes=0;
for await(const chunk of response.body){bytes+=chunk.length;assert(bytes<=2_000_000,'bounded bundle');chunks.push(chunk);}
const bundle=Buffer.concat(chunks),digest=createHash('sha256').update(bundle).digest('hex');
const downloadMs=performance.now()-downloadedAt;
const assetOrigin='http://127.0.0.1:7021',parentOrigin='http://127.0.0.1:7020';
const requests=[];
const assets=createServer((req,res)=>{
  requests.push({path:req.url,origin:req.headers.origin??null,cookie:req.headers.cookie??null,method:req.method});
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(!req.url.startsWith('/nocors/'))res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','public,max-age=3600,immutable');
  if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url.endsWith('.json')){res.setHeader('Content-Type','application/json');res.end('{"cached":true,"n":7}');}
  else{res.writeHead(404);res.end();}
});
await new Promise(resolve=>assets.listen(7021,'127.0.0.1',resolve));
const literal=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const policy=`default-src 'none'; script-src 'unsafe-inline' ${assetOrigin}; connect-src ${assetOrigin}; style-src 'unsafe-inline'; img-src blob: data:; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`;
const scene=`
const boot=performance.now();
const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(400,300,false);
const scene=new THREE.Scene();scene.background=new THREE.Color('#101820');
const camera=new THREE.PerspectiveCamera(45,4/3,.1,100);camera.position.z=4;
const cube=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshNormalMaterial());scene.add(cube);
const durations=[],frames=[];let previous=0,started=performance.now();
function render(){const t=performance.now();renderer.render(scene,camera);durations.push(performance.now()-t);}
render();
const pixel=new Uint8Array(4);renderer.getContext().readPixels(200,150,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixel);
window.result={pixel:Array.from(pixel),renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),webglInitMs:performance.now()-boot,firstRenderEpochMs:performance.timeOrigin+performance.now(),rotation:0};
canvas.addEventListener('pointermove',event=>{if(event.buttons){cube.rotation.y+=.06;window.result.rotation=cube.rotation.y;render();}});
document.querySelector('button').onclick=()=>{cube.rotation.y+=.5;window.result.rotation=cube.rotation.y;render();};
window.measureAfterInteraction=()=>new Promise(resolve=>{const cadence=[];let prior=0,total=0;requestAnimationFrame(function tick(t){if(prior)cadence.push(t-prior);prior=t;cube.rotation.x+=.01;render();if(++total<60)requestAnimationFrame(tick);else resolve(cadence);});});
let count=0;
requestAnimationFrame(function tick(t){if(previous)frames.push(t-previous);previous=t;cube.rotation.x+=.01;render();if(++count<60)requestAnimationFrame(tick);else{window.result.renderMs=durations;window.result.frameIntervalsMs=frames;window.result.elapsedMs=performance.now()-started;window.ready=true;top.postMessage({type:'scene-ready',result:window.result},'*');}});
`;
const html=(cors=true)=>`<!doctype html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0}canvas{width:400px;height:300px;display:block}button{padding:8px}</style></head><body><canvas width="400" height="300" aria-label="Scene"></canvas><button aria-label="Rotate cube">Rotate cube</button><script${cors?' crossorigin="anonymous"':''} src="${assetOrigin}/assets/${digest}.js"></script><script>try{${scene}}catch(error){window.error=String(error);top.postMessage({type:'scene-error',error:String(error)},'*');}</script>`;
const frameScript=inner=>`const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style='width:420px;height:360px;border:0';frame.title='Visible scene';frame.srcdoc=${literal(inner)};document.body.append(frame);`;
const wrapper=inner=>`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0}</style><body><script>${frameScript(inner)}</script>`;
const host=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
  const shape=req.url.split('?')[0].slice(1);
  if(shape==='top'){res.setHeader('Content-Security-Policy',policy);res.end(html());return;}
  if(!['iframe','wrapper'].includes(shape)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Security-Policy',policy.replace("frame-src 'none'",`frame-src ${assetOrigin}`));
  res.end(`<!doctype html><style>body{margin:0}</style><body><script>window.message=null;addEventListener('message',e=>{if(e.data?.type==='scene-ready'||e.data?.type==='scene-error')window.message=e.data});${frameScript(shape==='wrapper'?wrapper(html()):html())}</script>`);
});
await new Promise(resolve=>host.listen(7020,'127.0.0.1',resolve));
const browser=await {chromium,firefox,webkit}[selected].launch(selected==='chromium'?{args:['--enable-unsafe-swiftshader']}:{});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const summarise=values=>({median:percentile(values,.5),p95:percentile(values,.95),min:Math.min(...values),max:Math.max(...values)});
try{
  const rows=[];
  const shapes=['top','iframe','wrapper'];
  for(let sample=0;sample<samples;sample++)for(const shape of [...shapes.slice(sample%3),...shapes.slice(0,sample%3)]){
    // Fresh browser context each sample: server cache warm, browser cache cold.
    const context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:1});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    const started=performance.now();await page.goto(parentOrigin+'/'+shape);
    const child=shape==='top'?page.mainFrame():await (async()=>{await page.waitForFunction(()=>window.message);return page.frames().at(-1);})();
    await child.waitForFunction(()=>window.ready||window.error,null,{timeout:20000});
    const result=await child.evaluate(()=>({result:window.result,error:window.error}));
    assert(!result.error,result.error);
    assert(result.result.pixel[0]>60&&result.result.pixel[1]>60,'cube center, not the dark background, was rendered');
    const stableReadyMs=performance.now()-started;
    const parentTimeOrigin=await page.evaluate(()=>performance.timeOrigin);
    const before=result.result.rotation;
    await child.getByLabel('Rotate cube').click();
    const afterInteraction=await child.evaluate(()=>window.measureAfterInteraction());
    const bounds=await child.getByLabel('Scene').boundingBox();
    await page.mouse.move(bounds.x+200,bounds.y+150);await page.mouse.down();await page.mouse.move(bounds.x+240,bounds.y+160,{steps:4});await page.mouse.up();
    const interacted=await child.evaluate(()=>window.result.rotation);
    assert(interacted>before+.5,'button and pointer interactions render inside own visible canvas');
    const capability=await child.evaluate(async asset=>{
      let parentDom='allowed';try{parent.document.body.nodeName;}catch(error){parentDom=error.name;}
      const get=async(path,options)=>fetch(asset+path,options).then(async r=>({ok:true,status:r.status,body:await r.text()}),error=>({ok:false,error:error.name}));
      const xhr=path=>new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET',asset+path);x.onload=()=>resolve({ok:true,status:x.status,body:x.responseText});x.onerror=()=>resolve({ok:false});x.send();});
      const load=(path,crossOrigin,type)=>new Promise(resolve=>{const script=document.createElement('script');script.src=asset+path;if(crossOrigin)script.crossOrigin=crossOrigin;if(type)script.type=type;script.onload=()=>{script.remove();resolve(true);};script.onerror=()=>{script.remove();resolve(false);};document.body.append(script);});
      return {origin:location.origin,parentDom,fetchCors:await get('/assets/data.json'),fetchNoCors:await get('/nocors/data.json'),xhrCors:await xhr('/assets/data.json'),xhrNoCors:await xhr('/nocors/data.json'),credentialed:await get('/assets/data.json',{credentials:'include'}),remote:await fetch('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js').then(()=>true,()=>false),classicWithoutCors:await load('/nocors/bundle.js'),classicCrossoriginWithoutCors:await load('/nocors/bundle.js','anonymous'),moduleWithoutCors:await load('/nocors/bundle.js',undefined,'module')};
    },assetOrigin);
    assert(capability.fetchCors.ok&&capability.xhrCors.ok);
    assert(!capability.fetchNoCors.ok&&!capability.xhrNoCors.ok&&!capability.credentialed.ok&&!capability.remote);
    assert(capability.classicWithoutCors&&!capability.classicCrossoriginWithoutCors&&!capability.moduleWithoutCors);
    if(shape!=='top')assert.equal(capability.parentDom,'SecurityError');
    rows.push({shape,sample,pixel:result.result.pixel,stableReadyMs,firstRenderMs:result.result.firstRenderEpochMs-parentTimeOrigin,webglInitMs:result.result.webglInitMs,renderMs:summarise(result.result.renderMs),frameIntervalsMs:summarise(result.result.frameIntervalsMs),afterClickFrameIntervalsMs:summarise(afterInteraction),capability,renderer:result.result.renderer,errors});
    await context.close();
  }
  const summary=Object.fromEntries(['top','iframe','wrapper'].map(shape=>{const part=rows.filter(row=>row.shape===shape);return [shape,{startupToFirstRenderMs:summarise(part.map(row=>row.firstRenderMs)),startupTo60FramesMs:summarise(part.map(row=>row.stableReadyMs)),webglInitMs:summarise(part.map(row=>row.webglInitMs)),medianRenderMs:summarise(part.map(row=>row.renderMs.median)),medianFrameIntervalMs:summarise(part.map(row=>row.frameIntervalsMs.median)),afterClickMedianFrameIntervalMs:summarise(part.map(row=>row.afterClickFrameIntervalsMs.median))}];}));
  console.log(JSON.stringify({engine:selected,browserVersion:browser.version(),hardware:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,cores:cpus().length},bundle:{url:CDN,sha256:digest,bytes,downloadMs},samples,summary,rows,assetRequests:requests,caveats:['Laptop/headless synthetic400x300 scene, DPR1, no network/CPU throttle; not a device benchmark.','FirstRenderMs uses aligned performance.timeOrigin timestamps including outer-frame setup; readPixels forces the first rendered pixel, not a screenshot paint timestamp.','No byte or input/output relay per frame: browser composites child canvas directly.','Only a fixed self-contained classic bundle was used; no npm/module graph resolution or automatic bundling.','Static URL substitution only: relative URLs, module imports, workers, WebSockets, credentials and arbitrary library network semantics are not virtualized.','Native cross-origin fetch/XHR, crossorigin scripts and module scripts require CORS; classic scripts without crossorigin do not.','Credentialed fetch can send a request before CORS rejects reading its response; the asset server must be public/read-only, never an authority endpoint.','This proves capability/performance for these fixtures, not complete sandbox security.']},null,2));
}finally{await browser.close();await Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>assets.close(resolve))]);}
