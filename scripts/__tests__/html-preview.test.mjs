import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {startPreview} from '../../services/app/skills/artifactbin/scripts/preview.mjs';

test('private preview serves relative files, refuses writes, escapes and foreign hosts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-'));let session;
 try {
  const root=join(dir,'site');await mkdir(join(root,'nested'),{recursive:true});
  await writeFile(join(root,'index.html'),'<script src="nested/app.js"></script>');
  await writeFile(join(root,'nested/app.js'),'fetch("./data.json")');await writeFile(join(root,'nested/data.json'),'[1]');
  await writeFile(join(dir,'secret'),'secret');await symlink(join(dir,'secret'),join(root,'escape'));await writeFile(join(root,'.env'),'secret');
  session=await startPreview({root,port:0});
  const page=await fetch(session.url);assert.equal(page.status,200);assert.match(await page.text(),/nested\/app.js/);
  const csp=page.headers.get('content-security-policy');assert.match(csp,/connect-src 'self'/);assert.match(csp,/form-action 'none'/);assert.match(csp,/frame-src 'none'/);
  assert.equal(await (await fetch(session.url+'nested/data.json')).text(),'[1]');
  assert.equal((await fetch(session.url+'nested/app.js',{method:'HEAD'})).headers.get('content-type'),'text/javascript; charset=utf-8');
  assert.equal(await (await fetch(session.url,{method:'HEAD'})).text(),'');
  for(const path of ['escape','.env','%2e%2e%2fsecret','nested/','missing'])assert.equal((await fetch(session.url+path)).status,404,path);
  assert.equal((await fetch(session.url,{method:'POST',body:'x'})).status,405);
  assert.equal(await new Promise((done,reject)=>{request(session.url,{headers:{host:'evil.example'}},r=>{r.resume();done(r.statusCode);}).on('error',reject).end();}),403);
 } finally {await session?.close();await rm(dir,{recursive:true,force:true});}
});
