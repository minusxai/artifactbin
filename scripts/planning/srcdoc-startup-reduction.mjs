// Reduced startup diagnostic. No author workload, external requests, or production writes.
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const literal=v=>JSON.stringify(v).replaceAll('<','\\u003c');
const csp="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';frame-src 'none';connect-src 'none';base-uri 'none'";
const grid=process.argv.includes('--grid'),header=process.argv.includes('--header');
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),size=Number(u.searchParams.get('size')??0),depth=Number(u.searchParams.get('depth')??2),policy=u.searchParams.get('policy')!=='off';
 if(!Number.isFinite(size)||!Number.isInteger(size)||size<0||size>262144
   ||!Number.isFinite(depth)||!Number.isInteger(depth)||depth<0||depth>4){
  res.statusCode=400;res.end('size must be an integer from 0 to 262144; depth must be an integer from 0 to 4');return;
 }
 const meta=policy?`<meta http-equiv="Content-Security-Policy" content="${csp}">`:'';
 let doc=`<!doctype html>${meta}<body><p>Author ready</p><script>/*${'x'.repeat(size)}*/top.postMessage('author-ready','*');</script>`;
 for(let n=0;n<depth;n++)doc=`<!doctype html>${meta}<style>${grid?'html,body{margin:0;width:100%;height:100%}body{display:grid;grid-template-columns:repeat(1,1fr);grid-template-rows:repeat(1,1fr)}iframe{min-width:0;min-height:0;border:0;width:100%;height:100%}':'iframe{width:500px;height:300px}'}</style><body><script>${n===depth-1?"window.ready=false;addEventListener('message',e=>{if(e.data==='author-ready')ready=true;});":''}const f=document.createElement('iframe');f.sandbox='allow-scripts';f.srcdoc=${literal(doc)};document.body.append(f);</script>`;
 if(header)res.setHeader('Content-Security-Policy',csp.replace("frame-src 'none'",'frame-src http://127.0.0.1:7025'));
 res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end(doc);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const headed=process.argv.includes('--headed');
const browser=await chromium.launch({headless:!headed,...(process.argv.find(x=>x.startsWith('--executable='))?{executablePath:process.argv.find(x=>x.startsWith('--executable=')).slice(13)}:{})});
const rows=[];
try{
 for(const depth of [1,2])for(const size of [0,25000])for(const policy of ['on','off']){
  const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let failed=0;
  for(let n=0;n<10;n++){
   await page.goto(`${url}/?depth=${depth}&size=${size}&policy=${policy}`);
   try{await page.waitForFunction(()=>window.ready,{timeout:1500});}catch{failed++;}
  }
  rows.push({depth,size,policy,loads:10,failed,errors});console.error(JSON.stringify(rows.at(-1)));await context.close();
 }
 console.log(JSON.stringify({version:browser.version(),headed,grid,header,rows},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
