import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('misplaced remote flag is refused locally with the correct command surface',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-options-'));
 try {
  const r=spawnSync(process.execPath,[resolve('.artifactbin/probes/document-cli.mjs'),'pull','report.jsx','--remote'],{cwd:root,env:{PATH:process.env.PATH,ARTIFACTBIN_URL:'http://127.0.0.1:1'},encoding:'utf8'});
  assert.equal(r.status,1);const d=JSON.parse(r.stdout);assert.equal(d.code,'unknown_option');assert.match(d.fix,/status.*diff/);
 }finally{await rm(root,{recursive:true,force:true});}
});
