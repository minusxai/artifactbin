import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {removeRetiredLibraryOutput} from '../../services/app/scripts/library-output.mjs';
it('removes the exact retired runtime while preserving current and unrelated directories',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'library-output-'));
 try{
  for(const name of ['mermaid-12.0.0','pele-1.12.0','unrelated-1.0.0','notes']){await mkdir(path.join(dir,name));await writeFile(path.join(dir,name,'index.js'),name);}
  removeRetiredLibraryOutput(dir);
  await expect(access(path.join(dir,'mermaid-12.0.0'))).rejects.toThrow();
  for(const name of ['pele-1.12.0','unrelated-1.0.0','notes'])expect(await readFile(path.join(dir,name,'index.js'),'utf8')).toBe(name);
  expect(()=>removeRetiredLibraryOutput(dir)).not.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
