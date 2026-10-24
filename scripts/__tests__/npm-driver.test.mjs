import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
it('forwards exact npm run arguments and propagates child status without a shell shim',()=>{
 const root=mkdtempSync(join(tmpdir(),'npm driver é '));
 try{
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'npm-driver-fixture',version:'1.0.0',scripts:{capture:'node capture.cjs',fail:'node -e "process.exit(7)"'}}));
  writeFileSync(join(root,'capture.cjs'),"require('node:fs').writeFileSync(process.env.ARGV_CAPTURE,JSON.stringify({args:process.argv.slice(2),npm:process.env.npm_execpath}));");
  const args=['--ci','--install-only','--dependency-seed','seed é with spaces.tar'],output=join(root,'args.json'),driver=fileURLToPath(new URL('../ci/npm-driver.mjs',import.meta.url));
  const invoke=extra=>spawnSync(process.execPath,[driver,...extra],{cwd:root,encoding:'utf8',env:{...process.env,ARGV_CAPTURE:output}});
  const result=invoke(['run','capture','--',...args]);expect(result.status,result.stderr).toBe(0);
  const captured=JSON.parse(readFileSync(output,'utf8'));expect(captured.args).toEqual(args);expect(captured.npm).toMatch(/npm-cli\.js$/);
  expect(invoke(['run','fail']).status).toBe(7);
 }finally{rmSync(root,{recursive:true,force:true});}
});
