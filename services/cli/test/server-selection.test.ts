import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

for(const saved of [false,true])for(const explicit of [false,true]){
 test(`auth uses the selected origin without credentials (saved=${saved}, flag=${explicit})`,async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-origin-'));
  const selected=explicit?'http://localhost:7244':'http://localhost:7242';
  const calls:string[]=[];const output:string[]=[];
  try{
   if(saved)await saveConnection({server:'https://artifactbin.dev',token:'mx_saved'},home);
   const code=await runCli(['auth','--no-browser','--json',...(explicit?['--server',selected]:[])],{
    home,cwd:home,env:{ARTIFACTBIN_URL:'http://localhost:7242'},interactive:false,stdout:s=>output.push(s),stderr:()=>{},
    fetch:async input=>{
     const url=new URL(String(input));calls.push(url.origin);
     return url.pathname==='/oauth/device'
      ?Response.json({device_code:'d'.repeat(43),user_code:'ABCD-EFGH',verification_uri_complete:selected+'/oauth/device?user_code=ABCD-EFGH',expires_in:300,interval:5})
      :Response.json({access_token:'access',refresh_token:'refresh',client_id:'client',expires_in:3600});
    },
   });
   assert.equal(code,0);
   assert.deepEqual(calls,[selected,selected]);
   assert.equal(JSON.parse(output.join('')).server,selected);
  }finally{await rm(home,{recursive:true,force:true});}
 });
}
