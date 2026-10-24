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

test('disk revisions include dependencies, atomic saves and deletions without modifying source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-revisions-'));let session;
 try {
  await writeFile(join(dir,'index.html'),'<h1>Original</h1>');await writeFile(join(dir,'data.json'),'[1]');
  session=await startPreview({root:dir,revisionIntervalMs:0});
  const revision=async()=> (await (await fetch(session.url+'__af_preview/revision')).json()).revision;
  const first=await revision();
  const html=await (await fetch(session.url)).text();assert.match(html,/File changed/);assert.match(html,/Reload/);
  await writeFile(join(dir,'data.json'),'[2]');const dependency=await revision();assert.notEqual(dependency,first);
  const {rename,unlink,readFile}=await import('node:fs/promises');
  await writeFile(join(dir,'next.html'),'<h1>Atomic</h1>');await rename(join(dir,'next.html'),join(dir,'index.html'));
  const atomic=await revision();assert.notEqual(atomic,dependency);
  await Promise.all([writeFile(join(dir,'a.json'),'1'),writeFile(join(dir,'b.json'),'2')]);assert.notEqual(await revision(),atomic);
  const beforeDelete=await revision();await unlink(join(dir,'data.json'));assert.notEqual(await revision(),beforeDelete);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),'<h1>Atomic</h1>');
  assert.equal((await fetch(session.url+'data.json')).status,404);
  // Reconnecting clients obtain the current revision without a retained server subscription.
  assert.equal(await revision(),await revision());
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('oversized projects and files fail with actionable size errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-limit-'));let session;
 try {
  const {open}=await import('node:fs/promises');const file=await open(join(dir,'large.bin'),'w');await file.truncate(33*1024*1024);await file.close();
  session=await startPreview({root:dir,revisionIntervalMs:0});
  const response=await fetch(session.url+'__af_preview/revision');assert.equal(response.status,413);assert.match((await response.json()).error,/limit|MiB/);
  const asset=await fetch(session.url+'large.bin');assert.equal(asset.status,413);assert.match(await asset.text(),/exceeds/);
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('revision scans share concurrent work and obey an injected cache clock',async()=>{
 const {createRevisionSource}=await import('../../services/app/skills/artifactbin/scripts/preview-changes.mjs');
 let now=0,calls=0,release;const source=createRevisionSource('/unused',{now:()=>now,scan:()=>{calls++;return new Promise(done=>{release=done;});}});
 const a=source.current(),b=source.current();await Promise.resolve();assert.equal(calls,1);release('first');assert.deepEqual(await Promise.all([a,b]),['first','first']);
 assert.equal(await source.current(),'first');assert.equal(calls,1);
 now=1001;const c=source.current();await Promise.resolve();assert.equal(calls,2);release('second');assert.equal(await c,'second');
});

test('revision limits bound file count and aggregate bytes',async()=>{
 const {projectRevision}=await import('../../services/app/skills/artifactbin/scripts/preview-changes.mjs');
 const dir=await mkdtemp(join(tmpdir(),'preview-count-'));
 try {await writeFile(join(dir,'a'),'123');await writeFile(join(dir,'b'),'456');
  await assert.rejects(projectRevision(dir,{maxFiles:1,maxFileBytes:10,maxTotalBytes:100}),/files/);
  await assert.rejects(projectRevision(dir,{maxFiles:10,maxFileBytes:10,maxTotalBytes:5}),/limit/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
