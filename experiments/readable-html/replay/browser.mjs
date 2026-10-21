import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`export {assembleStaticReplay,mountStaticReplay} from './experiments/readable-html/replay/assembler.ts';export {createSession} from './experiments/readable-html/replay/session.ts'`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Candidate'});
const requests=[];
const server=createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/bundle.js"></script><h1>Own live view</h1>');return}
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return}
  requests.push(req.url);res.writeHead(302,{Location:'/redirect-destination'});res.end();
});
server.on('upgrade',(req,socket)=>{requests.push(req.url);socket.destroy()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
try{
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();await page.goto(origin);requests.length=0;
  const result=await page.evaluate(async origin=>{
   window.upgrades=0;customElements.define('evil-widget',class extends HTMLElement{constructor(){super();window.upgrades++;fetch(origin+'/custom')}});
   const source=`<!doctype html><html><head><base href="${origin}/"><meta http-equiv="refresh" content="0;url=${origin}/refresh"><link rel="stylesheet" href="${origin}/css"><style>@import '${origin}/import';p{background:url('${origin}/background')}</style></head><body onload="fetch('${origin}/onload')"><h1 data-pagegi-id="title">Historical count 2</h1><p>Unicode café &amp; text</p><a href="${origin}/link" target="_top" ping="${origin}/ping">Inert link</a><form method="post" action="${origin}/form"><button autofocus formaction="${origin}/button">Submit</button></form><img src="${origin}/image" onerror="fetch('${origin}/error')" alt="Omitted chart"><iframe src="${origin}/frame"></iframe><object data="${origin}/object"></object><video src="${origin}/video" autoplay></video><svg><image href="${origin}/svg"/></svg><math><mtext><img src="${origin}/math"></mtext></math><evil-widget>Custom text</evil-widget><script>fetch('${origin}/fetch',{method:'POST'});navigator.sendBeacon('${origin}/beacon','x');new WebSocket('${origin.replace('http:','ws:')}/ws');parent.document.body.innerHTML='owned';location='${origin}/navigate';window.open('${origin}/popup');</script><template><img src="${origin}/template"></template></body></html>`;
   const sent=[]; const session=Candidate.createSession({count:7},new Map([['old',source]]),Candidate.assembleStaticReplay,m=>sent.push(m));
   const before=session.epoch;
   const replay=session.enter({sourceRevision:'old',snapshot:{count:2},renderedHtml:source});
   window.replay=replay;window.session=session;window.sent=sent;
   const frame=Candidate.mountStaticReplay(document.body,replay.html);frame.id='replay';
   const kinds=['state','presence','comment','edit'];for(const kind of kinds)session.publish({epoch:session.epoch,kind,value:{count:100}});
   let blocked=false;try{frame.contentWindow.document.body}catch{blocked=true}
   return {upgrades,blocked,mode:session.mode,html:replay.html,fidelity:replay.fidelity,before,sent:sent.length};
  },origin);
  assert.equal(result.upgrades,0);assert.equal(result.sent,0);assert.equal(result.fidelity,'captured-dom');
  const frame=page.frames().find(f=>f.parentFrame());await frame.waitForSelector('h1');
  assert.equal(await frame.locator('h1').textContent(),'Historical count 2');assert.equal(await frame.locator('h1').getAttribute('data-pagegi-id'),'title');
  await frame.getByText('Inert link',{exact:true}).click();await frame.getByText('Submit',{exact:true}).click();
  const frameState=await frame.evaluate(()=>({body:document.body.textContent,active:document.querySelectorAll('script,style,a,form,button,iframe,img,svg,math,evil-widget,link,base').length,attrs:[...document.body.querySelectorAll('*')].flatMap(e=>[...e.attributes].map(a=>a.name))}));
  assert.equal(frameState.active,0);assert.ok(frameState.attrs.every(a=>a==='data-pagegi-id'));assert.ok(frameState.body.includes('café & text'));
  const restored=await page.evaluate(()=>{let blocked=false;try{document.querySelector('iframe').contentWindow.document.body}catch{blocked=true}const state=session.leave();const stale=session.publish({epoch:0,kind:'edit',value:99});const fresh=session.publish({epoch:session.epoch,kind:'presence',value:1});document.querySelector('iframe').remove();return {blocked,state,stale,fresh,sent:sent.length,upgrades}});
  assert.equal(restored.blocked,true);assert.deepEqual(restored.state,{count:7});assert.equal(restored.stale,false);assert.equal(restored.fresh,true);assert.equal(restored.sent,1);assert.equal(restored.upgrades,0);
  // Let delayed resource/event work settle; assertions also inspect all surviving markup.
  await new Promise(r=>setTimeout(r,200));assert.deepEqual(requests.filter(p=>p!=='/favicon.ico'),[]);
  console.log(JSON.stringify({engine,staticReplay:true,exactRevision:true,stableId:true,noCustomElementUpgrade:true,inertLinkAndFormText:true,resourceRequests:0,parentDomDenied:true,bridgeSuppressed:true,staleEpochRejected:true,ownState:7}));
 }finally{await browser.close()}
}
}finally{await new Promise(r=>server.close(r))}
