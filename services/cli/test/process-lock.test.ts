import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withProcessLock } from '../src/process-lock';

test('a process lock refuses a competing writer and the OS releases it after SIGKILL', async () => {
  const root = await mkdtemp(join(tmpdir(),'afbin-process-lock-'));
  const module = new URL('../src/process-lock.ts',import.meta.url).href;
  const child = spawn(process.execPath,['--import','tsx','--input-type=module','-e', `import {withProcessLock} from ${JSON.stringify(module)}; await withProcessLock(${JSON.stringify(root)}, async()=>{process.stdin.resume(); process.stdout.write('locked'); await new Promise(()=>{});});`],{stdio:['pipe','pipe','pipe']});
  try {
    const outcome = await Promise.race([once(child.stdout,'data').then(x=>String(x[0])),once(child,'exit').then(()=> 'exited')]);
    assert.equal(outcome,'locked');
    await assert.rejects(withProcessLock(root,async()=>assert.fail('competing writer entered')), /workspace_busy/);
    const exited = once(child,'exit'); child.kill('SIGKILL'); await exited;
    assert.equal(await withProcessLock(root,async()=> 'recovered'),'recovered');
  } finally { child.kill('SIGKILL'); await rm(root,{recursive:true,force:true}); }
});
