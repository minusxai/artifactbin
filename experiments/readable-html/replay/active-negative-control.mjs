import {createServer} from 'node:http';
import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
let navigations=0;
const server=createServer((req,res)=>{if(req.url==='/navigation'){navigations++;res.end('request received')}else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><h1>Host</h1>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
try{for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
const b=await type.launch();try{const p=await b.newPage();await p.goto(origin);navigations=0;
const response=p.waitForResponse(r=>r.url()===origin+'/navigation');
await p.evaluate(origin=>{const f=document.createElement('iframe');f.sandbox='allow-scripts';f.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><script>location.href='${origin}/navigation'</script>`;document.body.append(f)},origin);
await response;
assert.equal(navigations,1);console.log(JSON.stringify({engine,activeReplaySelfNavigationRequests:navigations}));
}finally{await b.close()}}
}finally{await new Promise(r=>server.close(r))}
