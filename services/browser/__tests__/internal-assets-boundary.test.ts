import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { internalAssetResponse } from '../src/internal-assets';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';

const origin = 'https://assets.invalid';
const path = '/assets/' + 'c'.repeat(64);
let app: RunningServer;
let reads = 0;
let closed = 0;
let mode = 'ok';
beforeAll(async () => {
  app = await withHttpServer((req,res) => {
    reads++;
    expect(req.headers['x-forwarded-host']).toBe('assets.invalid');
    expect(req.headers['x-forwarded-proto']).toBe('https');
    for (const name of ['cookie','authorization','origin','referer','x-mx-actor']) expect(req.headers[name]).toBeUndefined();
    req.on('close', () => closed++);
    if (mode === 'redirect') { res.writeHead(302,{location:app.base+'/private'});res.end();return; }
    if (mode === 'external-redirect') { res.writeHead(307,{location:'https://external.invalid/private'});res.end();return; }
    if (mode === 'oversize') { res.writeHead(200,{'content-length':String(65*1024*1024)});res.flushHeaders();return; }
    if (mode === 'stream-size') { res.writeHead(200);res.end(Buffer.alloc(65*1024*1024));return; }
    if (mode === 'slow') { res.writeHead(200);res.write('pending');return; }
    res.writeHead(200,{'content-type':'text/javascript','set-cookie':'secret=yes','location':'/private','access-control-allow-credentials':'true','content-security-policy':"default-src 'none'"});res.end('bytes');
  });
});
afterAll(async () => { await app.close(); });
const read = (url=origin+path, method='GET', signal=AbortSignal.timeout(3000)) => internalAssetResponse(url,method,origin,app.base,signal);
it('forwards only bytes with a fixed deployment Host and sanitized response policy',async()=>{
  mode='ok'; const response=await read();
  expect(await response.text()).toBe('bytes');
  for(const header of ['set-cookie','location','access-control-allow-credentials','content-length','content-encoding'])expect(response.headers.has(header)).toBe(false);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  expect(await (await read(origin+path,'HEAD')).text()).toBe('');
});
describe.each([
 ['non-asset',origin+'/api/my/session','GET'],['prefix',origin+'.evil'+path,'GET'],
 ['wrong origin','https://elsewhere.invalid'+path,'GET'],['POST',origin+path,'POST'],
 ['query',origin+path+'?key=private','GET'],['duplicate',origin+path+'?w=1&w=2','GET'],
 ['credentials','https://user:secret@assets.invalid'+path,'GET'],['traversal',origin+'/assets/../api/private','GET'],
])('%s',(_,url,method)=>it('never reaches the internal server',async()=>{
 const before=reads; await expect(read(url,method)).rejects.toThrow();expect(reads).toBe(before);
}));
for(const behavior of ['redirect','external-redirect','oversize','stream-size','slow'])it(`refuses ${behavior} and cancels the upstream`,async()=>{
 mode=behavior;const before=reads, beforeClosed=closed;
 await expect(read(origin+path,'GET',AbortSignal.timeout(behavior==='slow'?50:3000))).rejects.toThrow();
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(reads).toBe(before+1);expect(closed).toBeGreaterThan(beforeClosed);
});
