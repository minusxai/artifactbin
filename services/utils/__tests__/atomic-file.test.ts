import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicWrite} from '../src/atomic-file';

vi.mock('node:fs/promises',async original=>{
 const actual=await original<typeof import('node:fs/promises')>();
 return {...actual,rename:vi.fn(actual.rename)};
});
vi.mock('node:timers/promises',()=>({setTimeout:vi.fn(async()=>{})}));
const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
let root:string,path:string;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'atomic-file-'));path=join(root,'report.jsx');
 await writeFile(path,'old complete bytes');
 Object.defineProperty(process,'platform',{...platform,value:'win32'});
 vi.mocked(rename).mockReset().mockImplementation(actual.rename);vi.mocked(delay).mockClear();
});
afterEach(async()=>{Object.defineProperty(process,'platform',platform);await rm(root,{recursive:true,force:true});});
const failure=(code:string)=>Object.assign(new Error(code),{code});

it.each(['EPERM','EBUSY'])('replaces a temporarily locked Windows file atomically after %s releases',async code=>{
 let attempts=0;
 vi.mocked(rename).mockImplementation(async(from,to)=>{
  expect(await readFile(path,'utf8')).toBe('old complete bytes');
  if(++attempts<=2)throw failure(code);
  await actual.rename(from,to);
 });
 await atomicWrite(path,'new complete bytes');
 expect(attempts).toBe(3);expect(await readFile(path,'utf8')).toBe('new complete bytes');
 expect(await readdir(root)).toEqual(['report.jsx']);
});
it('bounds a permanent Windows lock and retains both the original error and original file',async()=>{
 const error=failure('EPERM');vi.mocked(rename).mockRejectedValue(error);
 await expect(atomicWrite(path,'new bytes')).rejects.toBe(error);
 expect(vi.mocked(rename).mock.calls).toHaveLength(6);
 expect(vi.mocked(delay).mock.calls.map(call=>call[0])).toEqual([25,50,100,200,400]);
 expect(await readFile(path,'utf8')).toBe('old complete bytes');expect(await readdir(root)).toEqual(['report.jsx']);
});
it.each(['EACCES','ENOSPC'])('reports unrelated Windows %s errors immediately without deleting the original',async code=>{
 const error=failure(code);vi.mocked(rename).mockRejectedValue(error);
 await expect(atomicWrite(path,'new bytes')).rejects.toBe(error);
 expect(vi.mocked(rename).mock.calls).toHaveLength(1);expect(delay).not.toHaveBeenCalled();
 expect(await readFile(path,'utf8')).toBe('old complete bytes');expect(await readdir(root)).toEqual(['report.jsx']);
});
it('does not retry POSIX rename failures',async()=>{
 Object.defineProperty(process,'platform',{...platform,value:'linux'});
 const error=failure('EPERM');vi.mocked(rename).mockRejectedValue(error);
 await expect(atomicWrite(path,'new bytes')).rejects.toBe(error);
 expect(vi.mocked(rename).mock.calls).toHaveLength(1);expect(delay).not.toHaveBeenCalled();
 expect(await readFile(path,'utf8')).toBe('old complete bytes');expect(await readdir(root)).toEqual(['report.jsx']);
});
it('uses the same atomic Windows retry when an existing cached object has different bytes',async()=>{
 vi.mocked(rename).mockRejectedValueOnce(failure('EPERM')).mockImplementation(actual.rename);
 await atomicWrite(path,'different cache bytes',{reuseIdentical:true});
 expect(vi.mocked(rename).mock.calls).toHaveLength(2);
 expect(await readFile(path,'utf8')).toBe('different cache bytes');expect(await readdir(root)).toEqual(['report.jsx']);
});
