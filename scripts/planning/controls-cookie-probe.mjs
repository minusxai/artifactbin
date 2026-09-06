/** Risk probe: HTTPS sibling controls keep login cookies host-only on the document/API origin. */
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const directory = mkdtempSync(join(tmpdir(), 'afbin-controls-cookie-'));
let browser;
let server;
try {
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=artifactbin.test','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem')], {stdio:'ignore'});
  let root, controls, controlsCookie;
  server = createServer({key:readFileSync(join(directory,'key.pem')),cert:readFileSync(join(directory,'cert.pem'))}, (req,res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    if (url.pathname === '/api/probe') {
      if (req.headers.origin !== controls) {res.writeHead(403); return res.end();}
      res.setHeader('Access-Control-Allow-Origin', controls);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') {res.writeHead(204); return res.end();}
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({authenticated:req.headers.cookie?.includes('__Host-probe=fixture') === true}));
    }
    res.setHeader('Content-Type', 'text/html');
    if (url.origin === root) {
      res.setHeader('Set-Cookie', '__Host-probe=fixture; Secure; HttpOnly; SameSite=Lax; Path=/');
      res.setHeader('Content-Security-Policy', `sandbox allow-scripts allow-same-origin; frame-src ${controls}; script-src 'unsafe-inline'`);
      return res.end(`<iframe title="controls" src="${controls}/controls"></iframe>`);
    }
    controlsCookie = req.headers.cookie;
    return res.end(`<script>window.result=fetch(${JSON.stringify(root+'/api/probe')},{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'include'}).then(r=>r.json());</script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  root = `https://artifactbin.test:${port}`;
  controls = `https://i.artifactbin.test:${port}`;
  browser = await chromium.launch({args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']});
  const context = await browser.newContext({ignoreHTTPSErrors:true});
  const page = await context.newPage();
  await page.goto(root);
  const child = page.frames().find(frame => frame.url().startsWith(controls));
  assert.ok(child);
  assert.deepEqual(await child.evaluate(() => window.result), {authenticated:true});
  assert.equal(controlsCookie, undefined, 'No cookie is sent to the controls host');
  assert.equal((await context.cookies(root))[0].domain, 'artifactbin.test');
  assert.equal(await child.evaluate(() => {try {return parent.document.body.innerHTML;} catch (e) {return e.name;}}), 'SecurityError');
  const refusal = await context.request.post(`https://127.0.0.1:${port}/api/probe`, {headers:{Origin:'https://evil.artifactbin.test'},data:{}});
  assert.equal(refusal.status(),403);
  assert.equal(refusal.headers()['access-control-allow-origin'],undefined);
  console.log('PASS: HTTPS sibling iframe authenticates credentialed API requests with root host-only HttpOnly cookies; no cookie sharing or session handoff; parent DOM inaccessible');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(directory, {recursive:true,force:true});
}
