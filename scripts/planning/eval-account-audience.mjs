// Reproduce the CI credential seam without a paid model or production data:
// node --import tsx scripts/planning/eval-account-audience.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {serverEnv,startServer,devOutboxPath} from '../../evals/lib/server.ts';
import {acquireCredential} from '../../evals/lib/credential.ts';

const port=await new Promise(resolve=>{
  const listener=net.createServer();
  listener.listen(0,'127.0.0.1',()=>{
    const selected=listener.address().port;
    listener.close(()=>resolve(selected));
  });
});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'afbin-eval-audience-'));
const env=serverEnv({base:process.env,ports:{server:port,proxy:port+1},dataDir:dir,repoRoot:process.cwd(),extra:{S3_URL:''}});
const server=await startServer({repoRoot:process.cwd(),env,logPath:path.join(dir,'server.log')});
try {
  const credential=await acquireCredential('outbox-oauth',{base:server.url,origin:env.APP__PUBLIC_BASE_URL,env:{},localOutbox:devOutboxPath(dir),email:'mxmx_audience_check@example.com'});
  assert(credential.apiToken && credential.apiToken!==credential.token);
  const create=token=>fetch(server.url+'/api/artifacts',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({markup:'<p>Audience check</p>',visibility:'unlisted'})});
  assert.equal((await create(credential.token)).status,401);
  const published=await create(credential.apiToken);
  assert.equal(published.status,201);
  const body=await published.json();
  const listed=await fetch(server.url+'/api/my/artifacts',{headers:{cookie:credential.cookie}});
  assert.equal(listed.status,200);
  assert((await listed.text()).includes(body.id));
  console.log('PASS real OTP/OAuth: MCP token refused REST; separate API token publishes into the same human account');
} finally {await server.stop();}
