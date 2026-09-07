// Planning-only exact author workload. No product code or remote writes.
// node scripts/planning/ocean-workload-perf.mjs <capture.txt> [chromium|firefox|webkit] [samples=2] [counts=1,4,8] [--cube] [--headed|--interactive]
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const [source,engine='chromium',sampleArg='2',countArg='1,4,8']=process.argv.slice(2);
assert(source,'capture path required');
const raw=readFileSync(source,'utf8');
const capture=JSON.parse(raw.slice(raw.indexOf('\n{')+1,raw.lastIndexOf('\n}')+2));
const capturedAuthor=capture.scripts.at(-1).text;
assert(capturedAuthor.includes("artifact.library('three')")&&capturedAuthor.includes('pond'));
const cube=process.argv.includes('--cube');
const deferInner=process.argv.includes('--defer-inner');
const author=cube?`(async()=>{const T=await artifact.library('three'),canvas=document.getElementById('pond'),renderer=new T.WebGLRenderer({canvas,antialias:true});const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.z=4;const mesh=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshNormalMaterial());scene.add(mesh);let paused=false,id;const observer=new ResizeObserver(()=>{renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();});observer.observe(canvas);function render(){id=requestAnimationFrame(render);if(!paused)mesh.rotation.y+=.01;renderer.render(scene,camera);}render();document.getElementById('scene-status').hidden=true;document.getElementById('pause').onclick=()=>paused=!paused;document.getElementById('ripple').onclick=()=>mesh.rotation.x+=.4;document.getElementById('breeze').oninput=()=>document.getElementById('wind-label').textContent='Whitecaps';addEventListener('pagehide',()=>{cancelAnimationFrame(id);observer.disconnect();mesh.geometry.dispose();mesh.material.dispose();renderer.dispose();},{once:true});})();`:capturedAuthor;
const bundle=readFileSync(new URL('../../services/app/public/libraries/three-0.185.1/index.js',import.meta.url));
const samples=Number(sampleArg),counts=countArg.split(',').map(Number);
assert(samples>=1&&samples<=5&&counts.every(n=>[1,4,8].includes(n)));
const shapes=(process.argv.find(x=>x.startsWith('--shapes='))?.slice(9)??'top,iframe,wrapper').split(',');
assert(shapes.every(x=>['top','iframe','wrapper'].includes(x)));
const asset='http://127.0.0.1:7025',host='http://127.0.0.1:7024',requests=[];
const payload=Buffer.alloc(2*1024*1024,97);
const assets=createServer((req,res)=>{
 requests.push({url:req.url,at:Date.now()});
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','public,max-age=3600,immutable');
 if(req.url==='/three.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
 else if(/^\/large-[0-3]$/.test(req.url)){res.setHeader('Content-Type','application/octet-stream');res.end(payload);}
 else{res.writeHead(404);res.end();}
});
const policy=`default-src 'none'; script-src 'unsafe-inline' ${asset}; connect-src ${asset}; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
const literal=v=>JSON.stringify(v).replaceAll('<','\\u003c');
const bootstrap=`
if(window===top){window.phase1=[];addEventListener('message',e=>{if(e.data?.type==='phase1')phase1.push(e.data.snapshot);});}
window.publishPhase1=()=>{const snapshot=window.snapshot();console.info('AFBIN_PHASE1 '+JSON.stringify(snapshot));top.postMessage({type:'phase1',snapshot},'*');};
window.metrics={renders:[],cadence:[],longTasks:[],renderers:[],pagehide:0,disposed:{geometry:[],material:[],texture:[],renderer:0},activeRAF:0,observers:0};
const m=window.metrics;let last=0;const active=new Set(),raf=requestAnimationFrame,cancel=cancelAnimationFrame;
document.addEventListener('click',()=>{m.clickIndex??=m.renders.length;},{capture:true});
window.requestAnimationFrame=fn=>{let id=raf(t=>{active.delete(id);m.activeRAF=active.size;fn(t);});active.add(id);m.activeRAF=active.size;return id;};
window.cancelAnimationFrame=id=>{active.delete(id);m.activeRAF=active.size;cancel(id);};
const RO=ResizeObserver;window.ResizeObserver=class extends RO{constructor(fn){super(fn);m.observers++;}disconnect(){super.disconnect();m.observers--;}};
try{new PerformanceObserver(list=>m.longTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask',buffered:true});}catch{}
window.artifact={library:async name=>{if(name!=='three')throw Error('undeclared library');const T=await import('${asset}/three.js');
 for(const [kind,Proto] of [['geometry',T.BufferGeometry],['material',T.Material],['texture',T.Texture]]){const dispose=Proto.prototype.dispose;Proto.prototype.dispose=function(){if(!m.disposed[kind].includes(this.id))m.disposed[kind].push(this.id);return dispose.call(this);};}
 class Renderer extends T.WebGLRenderer {
  constructor(options){super(options);m.renderers.push(this);const gl=this.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
   m.glRenderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
   const render=this.render.bind(this),dispose=this.dispose.bind(this);
   this.render=(s,c)=>{const start=performance.now();render(s,c);const now=performance.now();
    if(!m.firstRender)m.firstRender=performance.timeOrigin+now;if(last)m.cadence.push(now-last);last=now;
    m.renders.push(now-start);m.scene=s;m.info={memory:{...this.info.memory},render:{...this.info.render},programCount:this.info.programs?.length};
    if(m.renders.length===35)publishPhase1();
    if(m.clickIndex!==undefined&&m.renders.length===m.clickIndex+35)console.info('AFBIN_PHASE2 '+JSON.stringify({cadence:m.cadence.slice(m.clickIndex),renders:m.renders.slice(m.clickIndex),activation:{active:navigator.userActivation?.isActive,ever:navigator.userActivation?.hasBeenActive}}));
   };this.dispose=()=>{dispose();m.disposed.renderer++;};
  }
 }
 return {...T,WebGLRenderer:Renderer};}};
window.snapshot=()=>{const unique={geometry:new Set(),material:new Set(),texture:new Set()};m.scene?.traverse(o=>{if(o.geometry)unique.geometry.add(o.geometry.id);for(const mat of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){unique.material.add(mat.id);for(const v of Object.values(mat))if(v?.isTexture)unique.texture.add(v.id);}});return {firstRender:m.firstRender,renders:m.renders.slice(),cadence:m.cadence.slice(),longTasks:m.longTasks,info:m.info,retainedMemory:m.renderers.map(r=>({...r.info.memory,programs:r.info.programs?.length})),activation:{active:navigator.userActivation?.isActive,ever:navigator.userActivation?.hasBeenActive},knownResources:Object.fromEntries(Object.entries(unique).map(([k,v])=>[k,v.size])),disposed:m.disposed,activeRAF:m.activeRAF,observers:m.observers,pagehide:m.pagehide,glRenderer:m.glRenderer,canvas:[pond.width,pond.height],status:document.getElementById('scene-status').textContent};};
addEventListener('pagehide',()=>{m.pagehide++;queueMicrotask(()=>top.postMessage({type:'disposed',snapshot:snapshot()},'*'));});
`;
const scene=()=>`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:calc(100% - 36px)}button,input{height:30px}</style><canvas id="pond"></canvas><button id="pause">Pause</button><button id="ripple">Ripple</button><input id="breeze" type="range" min="0.2" max="2" step="0.1" value="1"><span id="wind-label"></span><span id="scene-status">Starting</span><script>${bootstrap}</script><script>${author}</script>`;
// Compile fixture strings before starting any server/browser; never evaluate the captured author in Node.
new Function(bootstrap);new Function(author);
const frame=(content)=>`const f=document.createElement('iframe');f.sandbox='allow-scripts';f.style='border:0;width:100%;height:100%';f.srcdoc=${literal(content)};document.body.append(f);`;
const wrapper=()=>{
 const mount=frame(scene());
 // Optional diagnostic only: identical content/policy, but create the inner realm after outer load + one task.
 const script=deferInner?`addEventListener('load',()=>setTimeout(()=>{${mount}},0),{once:true});`:mount;
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%}</style><body><script>${script}</script>`;
};
const server=createServer((req,res)=>{
 const u=new URL(req.url,host),shape=u.pathname.slice(1),n=Number(u.searchParams.get('n')||1);
 res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
 if(shape==='top'){res.end(scene());return;}
 res.setHeader('Content-Security-Policy',policy.replace("frame-src 'none'",`frame-src ${asset}`));
 res.end(`<!doctype html><style>html,body{margin:0;height:100%;width:100%}body{display:grid;grid-template-columns:repeat(${n>1?2:1},1fr);grid-template-rows:repeat(${Math.ceil(n/2)},1fr)}iframe{min-width:0;min-height:0}</style><body><script>window.disposals=[];window.phase1=[];addEventListener('message',e=>{if(e.data?.type==='disposed')disposals.push(e.data.snapshot);if(e.data?.type==='phase1')phase1.push(e.data.snapshot)});for(let i=0;i<${n};i++){${frame(shape==='wrapper'?wrapper():scene())}}</script>`);
});
await Promise.all([new Promise(r=>assets.listen(7025,'127.0.0.1',r)),new Promise(r=>server.listen(7024,'127.0.0.1',r))]);
if(process.argv.includes('--interactive')){console.log(JSON.stringify({host,paths:['/top','/iframe?n=1','/wrapper?n=1'],workload:cube?'cube':'ocean'}));await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>assets.close(r))]);process.exit(0);}
const headed=process.argv.includes('--headed');
const browser=await {chromium,firefox,webkit}[engine].launch(engine==='chromium'?{headless:!headed,args:headed?['--use-angle=metal']:['--enable-unsafe-swiftshader']}:{headless:!headed});
const rows=[],failures=[];
const summary=a=>{const b=[...a].sort((a,b)=>a-b);return {n:b.length,median:b[Math.floor(b.length/2)],p95:b[Math.min(b.length-1,Math.floor(b.length*.95))]};};
try{
 for(let sample=0;sample<samples;sample++)for(const count of counts)for(const shape of shapes.slice(sample%shapes.length).concat(shapes.slice(0,sample%shapes.length))){
  if(shape==='top'&&count!==1)continue;
  const context=await browser.newContext({viewport:{width:960,height:720},deviceScaleFactor:1});const page=await context.newPage();
  const errors=[];let phaseSamples=[],phase2Samples=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.text().startsWith('AFBIN_PHASE1 '))phaseSamples.push(JSON.parse(m.text().slice(13)));if(m.text().startsWith('AFBIN_PHASE2 '))phase2Samples.push(JSON.parse(m.text().slice(13)));});let phase='start';
  try{for(const cache of ['cold','warm']){
   phase=cache;phaseSamples=[];phase2Samples=[];console.error(JSON.stringify({sample,count,shape,cache}));const requestStart=requests.length,started=performance.now();await page.goto(host+'/'+shape+'?n='+count);
   // Never evaluate in an author frame before passive samples: Playwright evaluation can emulate activation.
   for(let attempt=0;attempt<1200&&phaseSamples.length<count;attempt++)await new Promise(r=>setTimeout(r,50));
   assert.equal(phaseSamples.length,count,'autonomous passive sample count');
   const children=shape==='top'?[page.mainFrame()]:page.frames().filter(f=>f!==page.mainFrame()&&f.childFrames().length===0);
   assert.equal(children.length,count);
   const before=phaseSamples;
   const readyMs=performance.now()-started;
   for(const child of children){await child.locator('#pause').click();await child.locator('#ripple').click();await child.locator('#breeze').focus();await child.locator('#breeze').press('End');}
   for(let attempt=0;attempt<1200&&phase2Samples.length<count;attempt++)await new Promise(r=>setTimeout(r,50));
   assert.equal(phase2Samples.length,count,'autonomous after-click sample count');
   const origin=await page.evaluate(()=>performance.timeOrigin);
   for(const child of children)assert.equal(await child.locator('#wind-label').textContent(),'Whitecaps');
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
   const after=await Promise.all(children.map(f=>f.evaluate(()=>snapshot())));
   const resourceStart=requests.length;
   const resources=[];
   for(let pass=0;pass<2;pass++){const start=requests.length;const result=await children[0].evaluate(async origin=>{const t=performance.now();const sizes=await Promise.all([0,1,2,3].map(i=>fetch(origin+'/large-'+i,{credentials:'omit'}).then(r=>r.arrayBuffer()).then(b=>b.byteLength)));return {ms:performance.now()-t,sizes};},asset);assert(result.sizes.every(n=>n===payload.length));resources.push({pass,...result,requests:requests.slice(start)});}
   const resourceRequests=requests.slice(resourceStart);
   // Explicit lifecycle signal is contrasted with natural iframe removal below.
   await Promise.all(children.map(f=>f.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')))));
   const disposed=await Promise.all(children.map(f=>f.evaluate(()=>snapshot())));
   for(const d of disposed){assert.equal(d.activeRAF,0);assert.equal(d.observers,0);assert.equal(d.disposed.renderer,1);}
   rows.push({sample,count,shape,cache,readyMs,firstRenderMs:before.map(x=>x.firstRender-origin),before:before.map(x=>({...x,renders:summary(x.renders),cadence:summary(x.cadence)})),phase2:phase2Samples.map(x=>({...x,renders:summary(x.renders),cadence:summary(x.cadence)})),after:after.map(x=>({...x,renders:summary(x.renders),cadence:summary(x.cadence)})),disposed,resources,resourceRequests,assetRequests:requests.slice(requestStart),errors});
   await page.setViewportSize({width:960,height:720});
  }
  if(shape!=='top'){
   phase='natural-removal';const natural=[];
   for(let cycle=0;cycle<3;cycle++){
    await page.goto(host+'/'+shape+'?n=1');let child,ready=false;
    for(let attempt=0;attempt<100;attempt++){
     child=page.frames().at(-1);ready=await child.evaluate(()=>!!window.snapshot).catch(()=>false);
     if(ready)break;await page.waitForTimeout(50);
    }
    assert(ready,'natural-removal author frame did not bootstrap within5seconds');
    await child.waitForFunction(()=>window.metrics?.renders.length>=3,null,{timeout:60000});
    const before=await child.evaluate(()=>snapshot());await page.evaluate(()=>document.querySelector('iframe').remove());await page.waitForTimeout(100);
    natural.push({cycle,before:{knownResources:before.knownResources,info:before.info},disposals:await page.evaluate(()=>disposals),remainingFrames:page.frames().length});
   }
   rows.push({sample,count,shape,naturalRemoval:natural});
  }
  }catch(error){console.error(String(error));const diagnostics=[];for(const frame of page.frames())diagnostics.push(await frame.evaluate(()=>({url:location.href,hidden:document.hidden,visibility:document.visibilityState,ready:document.readyState,body:document.body?.getBoundingClientRect().toJSON(),children:[...document.body?.children??[]].map(e=>({tag:e.tagName,chars:e.textContent.length,srcdoc:e.getAttribute('srcdoc')?.length,window:e.tagName==='IFRAME'?!!e.contentWindow:undefined})),snapshot:window.snapshot?.()})).catch(e=>({error:String(e)})));failures.push({sample,count,shape,phase,error:String(error),errors,diagnostics});}finally{await context.close();}
 }
 console.log(JSON.stringify({engine,headed,deferInner,workload:cube?'cube':'captured-ocean',browser:browser.version(),hardware:{cpu:cpus()[0]?.model,cores:cpus().length},authorSha256:createHash('sha256').update(author).digest('hex'),bundleSha256:createHash('sha256').update(bundle).digest('hex'),rows,failures,caveats:[
  'Ocean mode executes exact captured source; cube mode is a separate lightweight scaling workload. artifact.library aliases generated Three0.185.1 ESM.',
  'Local synthetic layout, DPR1, no network/CPU throttle, not physical mobile. Headed setting and exposed GPU renderer are reported.',
  'CPU render call timings exclude asynchronous GPU completion; no input-to-photon claim.',
  'Known scene resources and dispose calls do not prove reclaimed browser/GPU memory.',
  'Longtask API may be unsupported. No unbounded resource guarantee.',
  'Top-level baseline supports one exact script only; multi-instance baseline is framed layouts.',
  'Explicit pagehide cleanup is synthetic; natural removal separately reports whether author callback fired.'
 ]},null,2));
 if(failures.length||rows.some(row=>row.errors?.length))process.exitCode=1;
}finally{await browser.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>assets.close(r))]);}
