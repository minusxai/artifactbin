import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startPreview} from '../src/preview/session';

const directives=(policy:string)=>new Map(policy.split(';').map(part=>{const [name,...sources]=part.trim().split(/\s+/);return [name,sources] as const;}));
test('compiled local preview clamps authored remote hosts while preserving local modules, query doors and fonts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-policy-')),previous=process.cwd(),assets=resolve('../app');let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const remote='https://example.invalid';
  await writeFile(join(root,'report.jsx'),'<Helmet><meta name="csp-connect" content="'+remote+'" /><meta name="csp-script" content="'+remote+'" /><meta name="csp-style" content="'+remote+'" /><meta name="csp-img" content="'+remote+'" /><style>{`@import url("'+remote+'/style.css");p{background-image:url("'+remote+'/pixel.png")}`}</style><script>{`export function example(){return fetch("'+remote+'/data")}`}</script></Helmet><p id="words">Local reader</p><img src="'+remote+'/pixel.png" />');
  process.chdir(assets);
  session=await startPreview({root,files:['report.jsx'],home:join(root,'home'),assets:join(assets,'preview'),publicAssets:join(assets,'public')});
  const response=await fetch(session.url+'/workspace/report.jsx');assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('x-dns-prefetch-control'),'off','links must not resolve remote hosts speculatively');
  const policy=response.headers.get('content-security-policy');assert.ok(policy,'local preview must return a browser-enforced resource policy');
  const rules=directives(policy);
  assert.deepEqual(rules.get('default-src'),["'none'"]);
  for(const kind of ['script-src','connect-src','img-src','style-src','font-src','media-src','frame-src','worker-src']){
   const sources=rules.get(kind);assert.ok(sources,kind);assert.ok(sources.includes("'self'"),kind);assert.ok(sources.every(source=>!/^https?:|^wss?:|^\*|^https:$/.test(source)),kind+' may not admit remote hosts');
  }
  assert.ok(rules.get('script-src')!.includes('blob:'));assert.ok(rules.get('script-src')!.includes("'wasm-unsafe-eval'"));assert.equal(rules.get('script-src')!.includes("'unsafe-inline'"),false);
  assert.ok(rules.get('img-src')!.includes('data:'));assert.ok(rules.get('font-src')!.includes('data:'));assert.ok(rules.get('style-src')!.includes("'unsafe-inline'"));assert.deepEqual(rules.get('form-action'),["'none'"]);assert.deepEqual(rules.get('base-uri'),["'none'"]);
  const html=await response.text();assert.equal(/src="\/islands\/d\/[0-9a-f]+\.js(?:\?[^"]*)?"/.test(html),true,'compiled module uses the session origin');assert.match(html,/src="\/bundle\/client\.js"/);assert.match(html,/\/query\?file=report\.jsx/);
  const script=/src="(\/islands\/d\/[0-9a-f]+\.js(?:\?[^"]*)?)"/.exec(html)![1]!;assert.equal((await fetch(session.url+script)).status,200,'compiled reader remains locally available');
 }finally{await session?.close();process.chdir(previous);await rm(root,{recursive:true,force:true});}
});
