import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {expect,it,onTestFinished} from 'vitest';
import {removeRetiredLibraryOutput} from '../../services/app/scripts/library-output.mjs';
import {tempDir} from '../../services/test-support/src/temp-dir.ts';
it('removes the exact retired runtime while preserving current and unrelated directories',async()=>{
 const dir=await tempDir('library-output-',onTestFinished);
  for(const name of ['mermaid-12.0.0','pele-1.12.0','unrelated-1.0.0','notes']){await mkdir(path.join(dir,name));await writeFile(path.join(dir,name,'index.js'),name);}
  removeRetiredLibraryOutput(dir);
  await expect(access(path.join(dir,'mermaid-12.0.0'))).rejects.toThrow();
  for(const name of ['pele-1.12.0','unrelated-1.0.0','notes'])expect(await readFile(path.join(dir,name,'index.js'),'utf8')).toBe(name);
  expect(()=>removeRetiredLibraryOutput(dir)).not.toThrow();
});
