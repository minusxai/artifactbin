import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveReference} from '../src/reference';

test('one resolver gives an existing full path precedence over version suffixes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-ref-'));
 try{
  await writeFile(join(root,'report.jsx'),'body');await writeFile(join(root,'report.jsx@2'),'shadow');
  assert.deepEqual(await resolveReference('report.jsx@2',{root}),{kind:'path',path:'report.jsx@2',notices:[expectShadow]});
  assert.deepEqual(await resolveReference('report.jsx@3',{root}),{kind:'path',path:'report.jsx',version:3,notices:[]});
  assert.deepEqual(await resolveReference('https://example.com/@user/abc123@4',{root,server:'https://example.com'}),{kind:'id',id:'abc123',version:4,notices:[]});
  assert.deepEqual(await resolveReference('https://example.com/@user/abc123-quarterly-report@4',{root,server:'https://example.com'}),{kind:'id',id:'abc123',version:4,notices:[]});
  for(const value of ['@2','abc123@0','missing.jsx','https://evil.example/a/abc123'])await assert.rejects(resolveReference(value,{root,server:'https://example.com'}));
  await assert.rejects(resolveReference('abc123@2',{root,writable:true}),/version/);
 }finally{await rm(root,{recursive:true,force:true});}
});
const expectShadow='Existing path report.jsx@2 takes precedence over report.jsx at version 2. Use the explicit artifact id@2 to select that version.';
test('decorative names and view parameters never change exact artifact identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pretty-ref-'));
 try{
  for(const url of ['https://example.com/@OLD_NAME/AbC123-','https://example.com/@wrong/AbC123-RENAMED?view=slide#heading','https://example.com/a/AbC123-old-title']){
   assert.deepEqual(await resolveReference(url,{root,server:'https://example.com'}),{kind:'id',id:'AbC123',notices:[]});
  }
  for(const url of ['https://other.example/a/AbC123','https://user:password@example.com/a/AbC123','https://example.com/api/artifacts/AbC123','https://example.com/@user/old-folder/AbC123'])await assert.rejects(resolveReference(url,{root,server:'https://example.com'}));
 }finally{await rm(root,{recursive:true,force:true});}
});
