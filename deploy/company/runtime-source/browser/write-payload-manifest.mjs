#!/usr/bin/env node
/** Bind every rebuilt native payload to the exact .deb bytes used by the final image. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const [packages,output]=process.argv.slice(2);
if(!packages||!output)throw Error('Expected package directory and output manifest');
const scratch=await mkdtemp(join(tmpdir(),'runtime-payloads-')),payloads=new Map();
try{
 for(const name of (await readdir(packages)).filter(name=>name.endsWith('.deb')).sort()){
  const directory=join(scratch,name);
  execFileSync('dpkg-deb',['--extract',join(packages,name),directory]);
  async function visit(relative=''){
   for(const entry of await readdir(join(directory,relative),{withFileTypes:true})){
    const path=join(relative,entry.name);
    if(entry.isDirectory())await visit(path);
    else if(entry.isFile()){
     const bytes=await readFile(join(directory,path));
     if(!bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))continue;
     const hash=createHash('sha256').update(bytes).digest('hex'),installed='/'+path;
     if(payloads.has(installed)&&payloads.get(installed)!==hash)throw Error('Conflicting native package payload');
     payloads.set(installed,hash);
    }
   }
  }
  await visit();
 }
 if(payloads.size===0)throw Error('No rebuilt native package payloads');
 await writeFile(output,JSON.stringify(Object.fromEntries([...payloads].sort()),null,2)+'\n');
}finally{await rm(scratch,{recursive:true,force:true});}
