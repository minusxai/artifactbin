import {mkdtempSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {materializeCli} from '../lib/cli-kit';
import {countDocsReads} from '../lib/docs-reads';
it('stages the actual CLI outside the checkout and runs offline without creating credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'afbin-eval-cli-'));
 try{
  const bin=materializeCli(join(root,'bin'));
  const output=execFileSync(join(bin,'afbin'),['--version','--json'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},encoding:'utf8'});
  expect(JSON.parse(output)).toMatchObject({protocol:1});
  expect(statSync(join(bin,'afbin')).mode&0o777).toBe(0o755);
  expect(existsSync(join(root,'.artifactbin'))).toBe(false);
  expect(()=>materializeCli(join(root,'missing'),join(root,'absent'))).toThrow('Build the CLI');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('counts local CLI help as reading guidance without counting writes',()=>{
 expect(countDocsReads([{name:'bash',input:{command:'afbin help markup'}},{name:'bash',input:{command:'afbin push -h'}},{name:'bash',input:{command:'afbin push report.jsx'}}])).toBe(2);
});
