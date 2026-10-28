import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const script=new URL('../../deploy/company/runtime-source/browser/xorg/xvfb-auth-profile.py',import.meta.url).pathname;
it('preserves both baseline authentication profiles and refuses added or removed Secure RPC',()=>{
 const root=mkdtempSync(join(tmpdir(),'xvfb-auth-'));
 try{
  const base=join(root,'base'),candidate=join(root,'candidate');
  const bytes=rpc=>Buffer.from('\x7fELF fixture MIT-MAGIC-COOKIE-1\0'+(rpc?'SUN-DES-1\0':''));
  for(const rpc of [false,true]){
   writeFileSync(base,bytes(rpc));writeFileSync(candidate,bytes(rpc));
   expect(execFileSync('python3',[script,base],{encoding:'utf8'}).trim()).toBe(String(rpc));
   expect(execFileSync('python3',[script,base,candidate],{encoding:'utf8'}).trim()).toBe(String(rpc));
   writeFileSync(candidate,bytes(!rpc));
   expect(()=>execFileSync('python3',[script,base,candidate],{stdio:'pipe'})).toThrow();
  }
  for(const invalid of ['not an ELF MIT-MAGIC-COOKIE-1\0','\x7fELF missing authentication table']){
   writeFileSync(base,invalid);
   expect(()=>execFileSync('python3',[script,base],{stdio:'pipe'})).toThrow();
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
