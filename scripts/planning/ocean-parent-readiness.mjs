// Observe actual autonomous rendering through parent messages, not CDP child visibility.
// node scripts/planning/ocean-parent-readiness.mjs CAPTURE_JSON [--cold]
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const capture=process.argv[2];assert(capture,'CAPTURE_JSON required');
const child=spawn(process.execPath,['scripts/planning/ocean-workload-perf.mjs',capture,'chromium','1','1','--interactive'],{stdio:['ignore','pipe','inherit']});
const lines=createInterface({input:child.stdout});await once(lines,'line');
const originalResponse=await fetch('http://127.0.0.1:7024/wrapper?n=1');
const policy=originalResponse.headers.get('content-security-policy');
const original=await originalResponse.text();
const server=createServer((_req,res)=>{
 res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',policy);
 // Diagnostic forwarding only: not a production authority/message bridge.
 res.end(original.replace('<body>','<body><script>addEventListener("message",e=>{if(e.data?.type==="phase1")console.info("PARENT_PHASE1 "+JSON.stringify(e.data.snapshot))});</script>'));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:false,args:['--use-angle=metal']});
const rows=[],cold=process.argv.includes('--cold');
try{
 let page=await browser.newPage({viewport:{width:960,height:720}});
 for(let i=0;i<30;i++){
  if(i&&cold){await page.close();page=await browser.newPage({viewport:{width:960,height:720}});}
  let authorConsole=false;
  const listener=m=>{if(m.text().startsWith('AFBIN_PHASE1 '))authorConsole=true;};page.on('console',listener);
  const ready=page.waitForEvent('console',{predicate:m=>m.text().startsWith('PARENT_PHASE1 '),timeout:6000}).then(m=>JSON.parse(m.text().slice(14)),()=>null);
  const started=performance.now();await page.goto('http://127.0.0.1:'+server.address().port);
  const snapshot=await ready;
  rows.push({i,ok:!!snapshot,authorConsole,frames:page.frames().length,ms:performance.now()-started,renders:snapshot?.renders.length,activation:snapshot?.activation});
  console.error(JSON.stringify(rows.at(-1)));page.off('console',listener);
 }
 console.log(JSON.stringify({browser:browser.version(),cold,rows},null,2));
 assert(rows.every(r=>r.ok&&r.renders>=35&&!r.activation.active&&!r.activation.ever),'Autonomous rendering did not complete');
}finally{await browser.close();await new Promise(r=>server.close(r));child.kill('SIGINT');await once(child,'exit');lines.close();}
