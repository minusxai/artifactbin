/** Release gate: execute the real binary outside the checkout, without writable temp or credentials. */
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const binary=resolve(`dist/afbin-${process.platform}-${process.arch}`),run=promisify(execFile);
const home=await mkdtemp(join(tmpdir(),'afbin-release-local-'));let requests=0;
const server=createServer((_request,response)=>{requests++;response.writeHead(500);response.end('Unexpected network');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const blocker=join(home,'blocked');await writeFile(blocker,'not a temp directory');await writeFile(join(home,'report.jsx'),'<article><h1>Offline release</h1></article>');
 const env={HOME:home,PATH:process.env.PATH,ARTIFACTBIN_URL:`http://127.0.0.1:${server.address().port}`,TMPDIR:blocker,TMP:blocker,TEMP:blocker};
 for(const args of [['--version','--json'],['-h'],['help','markup'],['help','operations'],['help','errors'],['validate','report.jsx','--json'],['status','--json'],['diff','--json']]){
  const result=await run(binary,args,{cwd:home,env,timeout:10000,maxBuffer:1048576});assert.equal(result.stderr,'',args.join(' '));if(args.includes('--json'))assert.doesNotThrow(()=>JSON.parse(result.stdout));
 }
 assert.equal(requests,0);await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
 const manifest=JSON.parse(await readFile(binary+'.manifest.json','utf8'));
 for(const asset of [manifest.binary,manifest.skills])assert.equal(createHash('sha256').update(await readFile(resolve('dist',asset.file))).digest('hex'),asset.sha256);
 console.log(`Release ${process.platform}/${process.arch}: offline help/validation/status/diff, zero requests/state, and asset checksums passed.`);
}finally{server.close();await rm(home,{recursive:true,force:true});}
