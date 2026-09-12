/** CI producer only. Publish a small, reusable Node dependency independently of CLI releases. */
import {copyFile,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageRuntime} from './runtime-package.mjs';
if(!process.env.CI)throw new Error('Runtime preparation runs only in CI.');
const root=resolve('node_modules/.cache/cli-node'),output=resolve('runtime-assets');
const binary=join(root,'prepared-node');
await mkdir(output,{recursive:true});
await copyFile(join(root,'node'),binary);
try{
 if(process.platform==='darwin')execFileSync('codesign',['--remove-signature',binary]);
 execFileSync('strip',process.platform==='darwin'?['-x',binary]:['--strip-all',binary]);
 if(process.platform==='darwin')execFileSync('codesign',['--sign','-',binary]);
 const recipe=JSON.parse(await readFile(join(root,'recipe.json'),'utf8'));
 execFileSync(binary,['-e',`const a=require('node:assert/strict');a.equal(process.version,'v${recipe.version}');a.equal(process.config.variables.icu_small,true);a.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(['en','fr','ja']),['en']);require('node:sqlite');require('node:sea');require('node:crypto').randomBytes(32);`],{stdio:'inherit'});
 const name=`afbin-node-${process.platform}-${process.arch}`;
 const metadata=await packageRuntime(binary,join(output,`${name}.gz`));
 await writeFile(join(output,`${name}.pin.json`),JSON.stringify({...metadata,recipe},null,2)+'\n');
}finally{await rm(binary,{force:true});}
