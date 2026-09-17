import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveReference} from '../src/reference';

// One deployment, two names: a link copied from either is the same artifact on the selected server.
test('a URL at a verified alias of the selected server resolves to its artifact id',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-alias-'));
 try{
  const options={root,server:'https://app.example.com',aliases:['https://example.com']};
  assert.deepEqual(await resolveReference('https://example.com/@sam/abc123-split-tracker?$exp_desc=Dinner',options),{kind:'id',id:'abc123',notices:[]});
  assert.deepEqual(await resolveReference('https://app.example.com/a/abc123@2',options),{kind:'id',id:'abc123',version:2,notices:[]});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an origin that is neither the server nor one of its aliases is still refused, and names both',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-alias-'));
 try{
  const options={root,server:'https://app.example.com',aliases:['https://example.com']};
  await assert.rejects(resolveReference('https://evil.example/a/abc123',options),(error:Error&{code?:string})=>{
   assert.equal(error.code,'wrong_server');
   assert.match(error.message,/evil\.example/);
   assert.match(error.message,/app\.example\.com/);
   return true;
  });
  await assert.rejects(resolveReference('https://user:pw@example.com/a/abc123',options));
  await assert.rejects(resolveReference('https://example.com/a/abc123',{root,server:'https://app.example.com'}));
 }finally{await rm(root,{recursive:true,force:true});}
});
