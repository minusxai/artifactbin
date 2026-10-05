import {it} from 'vitest';
import {mkdtemp,mkdir,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkInstalledTypes} from '../../services/cli/scripts/test-npm-types.mjs';
const require=createRequire(import.meta.url);
it('emits public declarations usable by real consumers without workspace aliases',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-public-types-'));
 try{
  const cli=join(root,'node_modules/@afbin/cli');await mkdir(join(cli,'dist'),{recursive:true});
  const types=join(root,'generated');
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',fileURLToPath(new URL('../../services/cli/tsconfig.build.json',import.meta.url)),'--outDir',types],{stdio:'pipe',timeout:30000});
  await cp(types,join(cli,'dist/types'),{recursive:true});
  await writeFile(join(cli,'package.json'),JSON.stringify({name:'@afbin/cli',type:'module',exports:{'.':{types:'./dist/types/cli/src/index.d.ts',import:'./dist/index.mjs'}}}));
  await checkInstalledTypes(join(cli,'dist/afbin.mjs'));
 }finally{await rm(root,{recursive:true,force:true});}
},45000);
