// Negative network test with a real loopback STUN sink and unsandboxed control.
import {createSocket} from 'node:dgram';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
import {protectedAuthorDocument} from '../../services/app/lib/story-runtime/author-frame.ts';
import {AUTHOR_SCRIPT_BOOTSTRAP} from '../../services/app/lib/story-runtime/author-script-bootstrap.ts';
const udp=createSocket('udp4');let packets=0;udp.on('message',()=>packets++);
await new Promise(r=>udp.bind(0,'127.0.0.1',r));
const policy="default-src 'none';script-src 'unsafe-inline';frame-src 'none';connect-src 'none';style-src 'unsafe-inline';base-uri 'none';form-action 'none'"+(process.argv.includes('--csp-webrtc')?";webrtc 'block'":"");
const script=`(async()=>{try{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udp.address().port}'}]});pc.createDataChannel('test');await pc.setLocalDescription(await pc.createOffer());top.postMessage({rtc:'created'},'*');setTimeout(()=>pc.close(),2000);}catch(e){top.postMessage({rtc:e.name+':'+e.message},'*');}})();`;
const lockdown=`for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection'])Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});`;
const tamper=`let rtcCandidate;for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection']){try{delete window[name]}catch{}try{Object.defineProperty(window,name,{value:()=>{}})}catch{}for(let p=window;p;p=Object.getPrototypeOf(p)){if(typeof p[name]==='function')rtcCandidate=p[name];}}try{const f=document.createElement('iframe');document.body.append(f);rtcCandidate=f.contentWindow.RTCPeerConnection;}catch(e){top.postMessage({freshRealm:e.name},'*');}`;
const hardening=process.argv.includes('--product')?AUTHOR_SCRIPT_BOOTSTRAP:process.argv.includes('--lockdown')?lockdown:null;
const inner='<meta http-equiv="Content-Security-Policy" content="'+policy+'"><body><script>'+(hardening?hardening+tamper+script.replace('new RTCPeerConnection','new rtcCandidate'):script)+'</script>';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/control'?'<body><script>addEventListener("message",e=>window.result=e.data.rtc);'+script+'</script>':'<body><script>addEventListener("message",e=>window.result=e.data.rtc);const f=document.createElement("iframe");f.sandbox="allow-scripts";f.srcdoc='+JSON.stringify(protectedAuthorDocument(inner)).replaceAll('<','\\u003c')+';document.body.append(f)</script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
 const browser=await engine.launch();try{const page=await browser.newPage();const rows=[];for(const path of ['/control','/nested']){const before=packets;await page.goto('http://127.0.0.1:'+server.address().port+path);await page.waitForFunction(()=>window.result);await new Promise(r=>setTimeout(r,2200));rows.push({path,result:await page.evaluate(()=>window.result),packets:packets-before});}console.log(JSON.stringify({engine:name,rows}));if(hardening){assert.equal(rows[1].packets,0);assert.match(rows[1].result,/TypeError/);}if(name!=='firefox')assert(rows[0].packets>0,'STUN positive control must send packets');}finally{await browser.close();}
}}finally{udp.close();await new Promise(r=>server.close(r));}
