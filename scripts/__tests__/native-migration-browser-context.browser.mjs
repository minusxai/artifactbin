/** Explicit local browser regression: node scripts/__tests__/native-migration-browser-context.browser.mjs. */
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {nativeMigrationBrowserContext} from '../lib/native-migration-browser-context.mjs';
const server=http.createServer((request,response)=>response.end(request.url==='/frame'?'actual frame':`<iframe sandbox="allow-scripts allow-same-origin" src="http://73616d706c65.lvh.me:${server.address().port}/frame"></iframe>`));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{const config=nativeMigrationBrowserContext('http://app.lvh.me:'+server.address().port,['sample']);for(const [label,channel,expected]of[['configured',config.channel,true]]){const browser=await chromium.launch({channel,args:['--host-resolver-rules=MAP *.lvh.me 127.0.0.1',...config.args]});try{const page=await browser.newPage();await page.goto(config.origins[0]);const facts=await Promise.all(page.frames().map(frame=>frame.evaluate(()=>({secure:isSecureContext,subtle:!!crypto.subtle}))));assert.equal(facts.length,2);for(const fact of facts){assert.equal(fact.secure,expected);assert.equal(fact.subtle,expected);}console.log(JSON.stringify({label,facts}));}finally{await browser.close();}}}finally{server.close();}
