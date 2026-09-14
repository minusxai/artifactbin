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

import {boundedRun} from '../lib/bounded-run';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
it('bounds setup and detached descendants, not just model time',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'afbin-deadline-'));
 const marker=path.join(dir,'escaped');
 const grandchild=`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'escaped'),900)`;
 const parent=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'ignore'});setTimeout(()=>{},1000)`;
 try {
  const result=await boundedRun(process.execPath,['-e',parent],300);
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
