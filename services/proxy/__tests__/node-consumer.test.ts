import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';

const require=createRequire(import.meta.url);
it('compiles public proxy exports for a strict Node-only downstream service',()=>{
  const result=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',fileURLToPath(new URL('./fixtures/node-consumer.json',import.meta.url)),'--listFiles'],{encoding:'utf8',timeout:60000});
  expect(result.error).toBeUndefined();
  const diagnostics=result.stdout.split('\n').filter(line=>line.includes('error TS')).join('\n')+result.stderr;
  expect(result.status,diagnostics).toBe(0);
  expect(result.stdout).not.toMatch(/[/\\]lib\.dom(?:\.iterable)?\.d\.ts(?:\r?\n|$)/);
},65000);
