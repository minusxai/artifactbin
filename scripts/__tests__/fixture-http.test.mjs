import {it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {observeFixtureWrite} from '../gates/lib/fixture-http.mjs';
it('loads the native fixture client from a standalone client working directory',()=>{
 const entry=new URL('../gates/lib/fixture-http.mjs',import.meta.url).href;
 const script=`const module=await import(${JSON.stringify(entry)}); if(typeof module.fixtureFetch!=='function')process.exit(1);`;
 expect(()=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:tmpdir(),timeout:10000,stdio:'pipe'})).not.toThrow();
});
it('reads the fixture head for conditional replacement without replacing an explicit stale guard',async()=>{
 const raw=vi.fn(async(_url,init)=>init?.method==='GET'?Response.json({version:7,state:'fresh'}):Response.json({ok:true}));
 await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',headers:{Authorization:'Bearer test'},body:JSON.stringify({html:'<!doctype html><h1>next</h1>',expectedVersion:2})});
 expect(raw).toHaveBeenCalledTimes(2);
 expect(JSON.parse(raw.mock.calls[1][1].body)).toEqual({html:'<!doctype html><h1>next</h1>',expectedVersion:2,expectedState:'fresh'});
 expect(raw.mock.calls[0][1].headers.Authorization).toBe('Bearer test');
});
it('does not intercept reads, edits, or already guarded writes',async()=>{
 const raw=vi.fn(async()=>Response.json({ok:true}));
 for(const [url,init] of [['https://example.test/api/artifacts/abc123',{}],['https://example.test/api/artifacts/abc123/edits',{method:'POST',body:'{}'}],['https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({expectedVersion:2,expectedState:'stale'})}]])await observeFixtureWrite(raw,url,init);
 expect(raw).toHaveBeenCalledTimes(3);
});
it('sends a complete HTML replacement to the original endpoint with observed guards',async()=>{
 const raw=vi.fn(async(_url,init)=>init?.method==='GET'?Response.json({version:3,state:'head'}):Response.json({ok:true}));
 const html='<!doctype html><html><body><p data-af-id="node-1">After</p></body></html>';
 await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({html})});
 const [url,init]=raw.mock.calls.at(-1);expect(url).toBe('https://example.test/api/artifacts/abc123');expect(init.method).toBe('PUT');
 expect(JSON.parse(init.body)).toEqual({html,expectedVersion:3,expectedState:'head'});
});
it('does not publish after the observed head is refused',async()=>{
 const raw=vi.fn(async()=>Response.json({error:'not_found'},{status:404}));
 expect((await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({html:'<p>Next</p>'})})).status).toBe(404);
 expect(raw).toHaveBeenCalledTimes(1);
});
it('keeps explicitly stale guards without reading a newer head',async()=>{
 const raw=vi.fn(async()=>Response.json({error:'conflict'},{status:409}));
 await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({html:'<p>Next</p>',expectedVersion:1,expectedState:'stale'})});
 expect(raw).toHaveBeenCalledTimes(1);expect(JSON.parse(raw.mock.calls[0][1].body).expectedState).toBe('stale');
});
