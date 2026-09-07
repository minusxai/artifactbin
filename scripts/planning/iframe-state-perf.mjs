// Actual author bootstrap; synthetic state producer. Not a server/network benchmark.
// node --import tsx scripts/planning/iframe-state-perf.mjs chromium
import {createServer} from 'node:http';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../../services/app/lib/story-runtime/author-script-bootstrap.ts';
const engine=process.argv[2]??'chromium';assert({chromium,firefox,webkit}[engine]);
const productBundle=(await build({stdin:{contents:"import {startAuthorScript} from './services/app/lib/story-runtime/author-script';import {createAuthorScriptBridge} from './services/app/lib/story-runtime/author-script-bridge';window.productStart=startAuthorScript;window.productBridge=createAuthorScriptBridge;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:'tsconfig.json'})).outputFiles[0].text;
const literal=x=>JSON.stringify(x).replaceAll('<','\\u003c');
const policy="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';frame-src 'none';connect-src 'none';form-action 'none';base-uri 'none'";
// Experimental delta branch ONLY in this probe. Full-state branch is unchanged.
// It establishes whether the measured cost is cloning unrelated tables, not nesting.
assert(AUTHOR_SCRIPT_BOOTSTRAP.includes("if (message.type === 'state')"));
const measuredBootstrap=AUTHOR_SCRIPT_BOOTSTRAP
 .replace("if (message.type === 'state')", "if (message.type === 'state' || message.type === 'values')")
 .replace('state = message.state; pending = message.pending;', "state = message.type === 'values' ? {...state, values: message.values} : message.state; pending = message.pending;")
 .replace('for (const listener of dataListeners)', "if (message.type === 'state') for (const listener of dataListeners)");
const author=`
window.bench={received:0,timers:0,messages:0,frames:0,last:0};
const output=document.createElement('output');document.body.append(output);
window.consume=state=>{output.textContent=String(state.values.seq);bench.received++;bench.last=state.values.seq;top.postMessage({bench:true,seq:state.values.seq,appliedAt:performance.timeOrigin+performance.now()},'*');};
if(window.mx){mx.params.subscribe(values=>consume({values}));mx.data.subscribe(()=>{});}
setInterval(()=>bench.timers++,20);
const channel=new MessageChannel();channel.port1.onmessage=()=>bench.messages++;window.ping=()=>channel.port2.postMessage(1);
requestAnimationFrame(function tick(){bench.frames++;requestAnimationFrame(tick);});
const button=document.createElement('button');button.textContent='Interact';button.onclick=e=>{bench.clicked=(bench.clicked??0)+1;bench.inputDelay=performance.now()-e.timeStamp;output.textContent='clicked';};document.body.append(button);
let sample=null;
addEventListener('message',e=>{if(e.source!==top)return;const command=e.data;
 if(command?.sampleStart){sample={id:command.sampleStart,old:{...bench},start:performance.now()};for(let i=0;i<100;i++)ping();}
 if(command?.sampleEnd&&sample?.id===command.sampleEnd){top.postMessage({sampleResult:sample.id,elapsed:performance.now()-sample.start,timers:bench.timers-sample.old.timers,messages:bench.messages-sample.old.messages,frames:bench.frames-sample.old.frames,documentHidden:document.hidden,inputDelay:bench.inputDelay??null},'*');sample=null;}
 if(command?.stressRequests&&window.mx){const start=performance.now();Promise.allSettled(Array.from({length:200},()=>mx.mutate('bench'))).then(results=>top.postMessage({stressResult:{elapsed:performance.now()-start,success:results.filter(x=>x.status==='fulfilled').length,failed:results.filter(x=>x.status==='rejected').length}},'*'));}
});
window.authorReady=true;top.postMessage({authorReady:true},'*');
`;
const child=`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><body><script>${measuredBootstrap}</script>`;
const wrapper=`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{margin:0}iframe{width:100%;height:100%;border:0}</style><body><script>
const child=document.createElement('iframe');child.sandbox='allow-scripts';child.srcdoc=${literal(child)};
let ready=false,waiting=null;function deliver(){if(!ready||!waiting)return;child.contentWindow.postMessage('mx:author:init','*',[waiting]);waiting=null;}
addEventListener('message',e=>{if(e.source===parent&&e.data==='bench-port'&&e.ports.length===1){waiting=e.ports[0];deliver();}});
child.onload=()=>{ready=true;deliver();};document.body.append(child);
</script>`;
const setup=`
window.current={values:{seq:0},tables:{data:{rows:[],columns:[]}},errors:{}};
window.waiters=new Map();window.acks=[];window.started=0;window.activePorts=[];window.authorWindows=[];window.sampleWaiters=new Map();window.requestCount=0;window.stressResult=null;let sampleId=0;
addEventListener('message',e=>{if(e.data?.bench){const r=e.data;acks.push(r);const w=waiters.get(r.seq);if(w){waiters.delete(r.seq);w(r);}}if(e.data?.authorReady){started++;authorWindows.push(e.source);}if(e.data?.sampleResult){sampleWaiters.get(e.data.sampleResult)?.(e.data);sampleWaiters.delete(e.data.sampleResult);}if(e.data?.stressResult)window.stressResult=e.data.stressResult;});
window.sample=()=>new Promise((resolve,reject)=>{const id=++sampleId;const target=authorWindows[0];const timeout=setTimeout(()=>reject(Error('sample timeout')),10000);sampleWaiters.set(id,r=>{clearTimeout(timeout);resolve(r);});target.postMessage({sampleStart:id},'*');setTimeout(()=>target.postMessage({sampleEnd:id},'*'),500);});
window.mount=async(shape,count=1)=>{
  document.querySelector('#hosts').replaceChildren();for(const p of activePorts)p.close();activePorts=[];started=0;authorWindows=[];
  if(shape==='top'){document.querySelector('#topCode')?.remove();const s=document.createElement('script');s.id='topCode';s.textContent=${literal(author)};document.body.append(s);return;}
  for(let i=0;i<count;i++){
    const frame=document.createElement('iframe');frame.title='Author '+i;frame.sandbox='allow-scripts';frame.style='width:300px;height:160px;border:0';
    frame.srcdoc=shape==='single'?${literal(child)}:${literal(wrapper)};
    frame.onload=()=>{const channel=new MessageChannel();activePorts.push(channel.port1);const bridge=productBridge({flow:{values:[],queries:[],mutations:[{name:'bench'}]},mutate:async()=>{}});channel.port1.onmessage=async e=>{requestCount++;channel.port1.postMessage(await bridge.request(e.data));};channel.port1.start();frame.contentWindow.postMessage(shape==='single'?'mx:author:init':'bench-port','*',[channel.port2]);channel.port1.postMessage({type:'state',state:current,pending:[]});channel.port1.postMessage({type:'run',source:${literal(author)}});};
    document.querySelector('#hosts').append(frame);
  }
  await new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const t=setInterval(()=>{if(started===count){clearInterval(t);resolve();}else if(Date.now()>deadline){clearInterval(t);reject(Error('mount timeout'));}},5);});
};
window.send=(seq)=>{current.values.seq=seq;if(activePorts.length)for(const p of activePorts)p.postMessage(window.delta?{type:'values',values:current.values,pending:[]}:{type:'state',state:current,pending:[]});else consume(current);};
window.roundtrip=seq=>new Promise((resolve,reject)=>{const t=setTimeout(()=>{waiters.delete(seq);reject(Error('state timeout'));},10000);waiters.set(seq,r=>{clearTimeout(t);resolve(r);});send(seq);});
`;
const server=createServer((req,res)=>{if(req.url==='/product.js'){res.setHeader('Content-Type','text/javascript');res.end(productBundle);return;}res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',policy.replace("script-src 'unsafe-inline'","script-src 'unsafe-inline' 'self'"));res.end(`<!doctype html><style>body{margin:0}#hosts{display:flex;flex-wrap:wrap}</style><body><div id="hosts"></div><script src="/product.js"></script><script>${setup}</script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await {chromium,firefox,webkit}[engine].launch({headless:!process.argv.includes('--headed')});
const stats=a=>{a=[...a].sort((x,y)=>x-y);return{n:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
const results=[];
try{
  for(const shape of ['top','single','nested'])for(const rows of [0,1000,10000])for(const delta of shape==='top'?[false]:[false,true]){
    const page=await browser.newPage({viewport:{width:1200,height:800}});await page.goto(origin);
    const startup=await page.evaluate(async({shape,rows,delta})=>{window.delta=delta;current.tables.data.rows=Array.from({length:rows},(_,id)=>({id,label:'task-'+id,status:'active',owner:'someone',hours:8}));const t=performance.now();await mount(shape);return performance.now()-t;},{shape,rows,delta});
    const serial=await page.evaluate(async()=>{const latency=[],submit=[];for(let n=1;n<=35;n++){const t=performance.timeOrigin+performance.now();const p=roundtrip(n);const submitted=performance.timeOrigin+performance.now();const r=await p;if(n>5){latency.push(r.appliedAt-t);submit.push(submitted-t);}}return{latency,submit};});
    const burst=await page.evaluate(async()=>{acks=[];const begin=performance.timeOrigin+performance.now();for(let n=100;n<200;n++)send(n);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('burst timeout')),10000);const check=()=>{if(acks.filter(x=>x.seq>=100).length===100){clearTimeout(t);resolve();}else setTimeout(check,5);};check();});return{elapsed:performance.timeOrigin+performance.now()-begin,received:acks.length,last:acks.at(-1).seq,firstLag:acks[0].appliedAt-begin,lastLag:acks.at(-1).appliedAt-begin};});
    assert.equal(burst.received,100);assert.equal(burst.last,199);
    const coalesced=await page.evaluate(async()=>{const t=performance.now();acks=[];let pending=false;for(let n=1000;n<1100;n++){current.values.seq=n;if(!pending){pending=true;queueMicrotask(()=>send(current.values.seq));}}await new Promise((resolve,reject)=>{const deadline=performance.now()+10000;function check(){if(acks.some(x=>x.seq===1099))return resolve();if(performance.now()>deadline)return reject(Error('coalesced timeout'));setTimeout(check,5);}check();});return{ms:performance.now()-t,observedStates:acks.length,last:acks.at(-1).seq};});
    assert.equal(coalesced.last,1099);assert.equal(coalesced.observedStates,1);
    results.push({shape,rows,mode:delta?'experimental-values-only':'current-full-state',startupMs:startup,signalDomMs:stats(serial.latency),producerSubmitMs:stats(serial.submit),burst,coalesced});
    await page.close();
  }
  const scheduling=[];
  for(const shape of ['top','single','nested']){
    const context=await browser.newContext({viewport:{width:1200,height:800}});const page=await context.newPage();await page.goto(origin);await page.evaluate(s=>mount(s),shape);
    const inner=shape==='top'?page.mainFrame():page.frames().at(-1);
    for(const visibility of ['visible','offscreen','hidden']){
      await page.evaluate(v=>{const host=document.querySelector('#hosts');host.style.display=v==='hidden'?'none':'';host.style.marginTop=v==='offscreen'?'3000px':'0';if(!activePorts.length)document.body.style.visibility=v==='hidden'?'hidden':'visible';},visibility);
      const measured=await page.evaluate(()=>window.sample());
      scheduling.push({shape,visibility,...measured});
    }
    await page.evaluate(()=>{document.querySelector('#hosts').style='';document.body.style.visibility='visible';});
    await inner.getByRole('button',{name:'Interact'}).click();
    const focused=await page.evaluate(()=>window.sample());
    scheduling.push({shape,visibility:'after-click',...focused});
    const other=await context.newPage();await other.goto(origin);await other.bringToFront();
    const background=await page.evaluate(()=>window.sample());
    scheduling.push({shape,visibility:'other-page-front',...background});
    await context.close();
  }
  const scale=[];
  for(const count of [1,4,8]){
    const page=await browser.newPage({viewport:{width:1200,height:800}});await page.goto(origin);await page.evaluate(n=>mount('nested',n),count);
    const outcome=await page.evaluate(async count=>{acks=[];const start=performance.now();for(let seq=1;seq<=100;seq++)send(seq);await new Promise((resolve,reject)=>{const deadline=performance.now()+10000;function check(){if(acks.length===100*count)return resolve();if(performance.now()>deadline)return reject(Error('scale timeout'));setTimeout(check,5);}check();});return{ms:performance.now()-start,acks:acks.length,ports:activePorts.length,domFrames:document.querySelectorAll('iframe').length};},count);
    assert.equal(outcome.acks,100*count);scale.push({count,...outcome});await page.close();
  }
  const backpressure=[];
  for(const shape of ['single','nested']){
    const page=await browser.newPage();await page.goto(origin);await page.evaluate(s=>mount(s),shape);
    await page.evaluate(()=>authorWindows[0].postMessage({stressRequests:true},'*'));
    await page.waitForFunction(()=>stressResult);
    const result=await page.evaluate(()=>({...stressResult,wireRequests:requestCount}));
    assert.equal(result.wireRequests,128);assert.equal(result.success,120);assert.equal(result.failed,80);
    backpressure.push({shape,...result});await page.close();
  }
  const lifecyclePage=await browser.newPage();await lifecyclePage.goto(origin);
  let session=null;if(engine==='chromium'){session=await lifecyclePage.context().newCDPSession(lifecyclePage);await session.send('HeapProfiler.collectGarbage');}
  const before=session?await session.send('Memory.getDOMCounters'):null;
  const lifecycle=await lifecyclePage.evaluate(async()=>{for(let n=0;n<30;n++)await mount('nested',4);document.querySelector('#hosts').replaceChildren();for(const p of activePorts)p.close();activePorts=[];return{remainingFrames:document.querySelectorAll('iframe').length,remainingPorts:activePorts.length};});
  if(session)await session.send('HeapProfiler.collectGarbage');
  const after=session?await session.send('Memory.getDOMCounters'):null;
  assert.equal(lifecycle.remainingFrames,0);assert.equal(lifecycle.remainingPorts,0);
  const productLifecycle=await lifecyclePage.evaluate(async source=>{
    const listeners=new Set();let peak=0;
    const store={flow:{values:[],queries:[],mutations:[]},getState:()=>current,pending:()=>[],subscribe:fn=>{listeners.add(fn);peak=Math.max(peak,listeners.size);return()=>listeners.delete(fn);}};
    for(let i=0;i<30;i++){
      const expected=started+1;const stop=productStart(source,store);
      await new Promise((resolve,reject)=>{const deadline=performance.now()+5000;const check=()=>{if(started>=expected)return resolve();if(performance.now()>deadline)return reject(Error('product mount timeout'));setTimeout(check,5);};check();});
      stop();if(listeners.size)throw Error('retained product store subscription');
    }
    return{cycles:30,peakSubscriptions:peak,remainingSubscriptions:listeners.size,remainingFrames:document.querySelectorAll('iframe').length};
  },author);
  if(session)await session.send('HeapProfiler.collectGarbage');
  const afterProduct=session?await session.send('Memory.getDOMCounters'):null;
  await lifecyclePage.close();
  console.log(JSON.stringify({engine,browserVersion:browser.version(),headed:process.argv.includes('--headed'),results,scheduling,scale,backpressure,lifecycle:{...lifecycle,before,after,productLifecycle,afterProduct},notes:['Actual AUTHOR_SCRIPT_BOOTSTRAP plus experimental values-only branch; state producer and ack protocol are benchmark fixtures. No server mutation latency is included.','Top baseline writes DOM directly; single/nested use actual full-state cloning/bootstrap or the explicitly experimental delta branch, including one data subscriber.','Signal latency means handler DOM assignment, not screen paint. Cross-realm timer precision can yield small negative near-zero readings; do not interpret those as negative real latency.','Unpaced burst delivers100 snapshots; explicit coalescing experiment delivers the final state once. Mutation commands are never coalesced.','Scheduling is measured by author-installed message samplers, with no child evaluate that could simulate user activation. Background result is meaningful only if documentHidden is true. CSS hidden/offscreen is distinct.','Product lifecycle bundles the actual startAuthorScript factory against a counted fixture store; this is not a guarantee of no GPU/process-memory leaks.','Backpressure uses actual bootstrap128-inflight and bridge120/sec limits; the underlying mutation executor is a zero-cost fixture, not a server.']},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
