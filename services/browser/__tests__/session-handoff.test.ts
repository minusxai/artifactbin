import {afterEach, expect, it} from 'vitest';
import {request} from 'node:http';
import {mkdtemp, rm, stat, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSessionHandoff} from '../src/session-handoff';
import {createBrowserSessions} from '../src/sessions';

const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
function call(socketPath:string,path:string,method='POST'):Promise<number|undefined>{
 return new Promise((resolve,reject)=>{
  const req=request({socketPath,path,method},res=>{res.resume();resolve(res.statusCode);});
  req.on('error',reject);req.end();
 });
}
it('the host can hold an idle registry and release it through its private unix socket',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'session-drain-'));dirs.push(dir);
 const path=join(dir,'control.sock');
 const sessions=createBrowserSessions(async()=>({run:async()=>({pages:[],attachments:[]}),close:async()=>{}}));
 const close=await openSessionHandoff(path,sessions);
 const actor={credential:'bearer' as const,tokenId:'test'};
 const input={op:'script' as const,actor,session_id:'one',create:true,execution_id:'a',code:'1'};
 try {
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await call(path,'/hold','GET')).toBe(405);
  expect(await call(path,'/other')).toBe(404);
  expect((await sessions.request(input)).status).toBe('queued');
  expect(await call(path,'/hold')).toBe(409);
  expect((await sessions.request({op:'close',actor,session_id:'one'})).status).toBe('closed');
  expect(await call(path,'/hold')).toBe(204);
  expect((await sessions.request({...input,session_id:'two'})).error?.code).toBe('SESSION_DRAINING');
  expect(await call(path,'/resume')).toBe(204);
  expect((await sessions.request({...input,session_id:'two'})).status).toBe('queued');
 }finally{await close();await sessions.close();}
 await chmod(dir,0o755);
 await expect(openSessionHandoff(path,sessions)).rejects.toThrow('private directory');
});
