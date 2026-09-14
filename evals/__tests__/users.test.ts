import type {DatasetColumn} from '@artifactbin/contracts';
import {describe,it,expect} from 'vitest';
import {nativeUserSchema} from '../lib/score/kinds/users';
import {TaskSchema} from '../lib/contracts';
import fs from 'node:fs';
const columns:DatasetColumn[]=[{name:'assigned_to',type:'user',constraints:{memberOf:['ref:abc123']}},{name:'completed_by',type:'user',constraints:{self:true}}];
describe('user smoke measures native field contracts',()=>{
 it('accepts an actual membership field and a current-actor field',()=>{
  expect(nativeUserSchema(columns,'abc123')).toEqual({assignee:'assigned_to',completed:'completed_by'});
 });
 it('refuses lookalike strings, missing self and a membership scope outside this report',()=>{
  expect(nativeUserSchema(columns.map(c=>({...c,type:'string'})),'abc123')).toBeNull();
  expect(nativeUserSchema([columns[0],{...columns[1],constraints:{}}],'abc123')).toBeNull();
  expect(nativeUserSchema(columns,'xyz456')).toBeNull();
  expect(nativeUserSchema([{...columns[0],constraints:{memberOf:['ref:abc123','ref:xyz456']}},columns[1]],'abc123')).toBeNull();
 });
 it('discovers one smoke task with every user assertion, without teaching syntax in its prompt',()=>{
  const task=TaskSchema.parse(JSON.parse(fs.readFileSync(new URL('../tasks/users.json',import.meta.url),'utf8')));
  expect(task.kind).toBe('users');
  expect(task.checks).toContain('user_constraints_enforced');
  expect(task.brief).not.toMatch(/\$_me|memberOf|self:|<Value/);
 });
});

import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {boundedRun} from '../lib/bounded-run';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
it('bounds setup and detached descendants, not just model time',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'afbin-deadline-'));
 const marker=path.join(dir,'escaped');
 const parent=`
  const child="setTimeout(()=>require('fs').writeFileSync(process.argv[1],'escaped'),900)";
  require('child_process').spawn(process.execPath,['-e',child,process.argv[1]],{detached:true,stdio:'ignore'});
  setTimeout(()=>{},1000);
 `;
 try {
  const args=['-e',parent,marker];
  expect(await boundedRun(process.execPath,args,2000)).toMatchObject({code:0,timedOut:false});
  expect(fs.readFileSync(marker,'utf8')).toBe('escaped');
  fs.rmSync(marker);
  const result=await boundedRun(process.execPath,args,300);
  expect(result.timedOut).toBe(true);
  expect(result.code).toBe(124);
  expect(result.elapsedMs).toBeLessThan(850);
  await delay(1000);
  expect(fs.existsSync(marker)).toBe(false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
it('preserves a completed process exit status',async()=>{
 expect(await boundedRun(process.execPath,['-e','process.exit(7)'],2000)).toMatchObject({code:7,timedOut:false});
});

it('launches the actual eval entry from the repository root',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const output=execFileSync(process.execPath,['--import','tsx','evals/bounded.ts','--help'],{cwd:root,encoding:'utf8'});
 expect(output).toContain('limit=120000ms PASS; no retry');
},15000);
