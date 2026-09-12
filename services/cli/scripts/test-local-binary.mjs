/** Release gate: execute the real binary outside the checkout, without writable temp or credentials. */
import {mkdtemp,writeFile,readFile,stat,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const binary=resolve(`dist/afbin-${process.platform}-${process.arch}`),run=promisify(execFile);
const home=await mkdtemp(join(tmpdir(),'afbin-release-local-'));let requests=0,corrupt=true;
const sqlBytes=await readFile(resolve(`dist/afbin-sql-${process.platform}-${process.arch}.gz`));
const server=createServer((request,response)=>{requests++;if(request.url.endsWith(`/afbin-sql-${process.platform}-${process.arch}.gz`)){response.end(corrupt?Buffer.from('corrupt'):sqlBytes);return;}response.writeHead(500);response.end('Unexpected network');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const blocker=join(home,'blocked');await writeFile(blocker,'not a temp directory');await writeFile(join(home,'report.jsx'),'<article><h1>Offline release</h1></article>');
 const env={HOME:home,PATH:process.env.PATH,ARTIFACTBIN_URL:`http://127.0.0.1:${server.address().port}`,TMPDIR:blocker,TMP:blocker,TEMP:blocker,CLI__SERVICE_BASE_URL:`http://127.0.0.1:${server.address().port}`};
 for(const args of [['--version','--json'],['-h'],['help','markup'],['help','publishing-auth'],['help','errors'],['help','--format','markdown'],['help','export','--format','man','--output','-'],['help','--format','man','--output','afbin.1','--json'],['validate','report.jsx','--json'],['status','--json'],['diff','--json']]){
  const result=await run(binary,args,{cwd:home,env,timeout:10000,maxBuffer:1048576});assert.equal(result.stderr,'',args.join(' '));if(args.includes('--json'))assert.doesNotThrow(()=>JSON.parse(result.stdout));
 }

 assert.equal(requests,0);await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
 await assert.rejects(run(binary,['setup','--service','sql','--json'],{cwd:home,env,timeout:30000}),error=>/checksum/i.test(error.stdout));
 assert.equal(requests,1);corrupt=false;
 // Independent processes publish the same verified cache without partial directories.
 const prepared=await Promise.all(Array.from({length:3},()=>run(binary,['setup','--service','sql','--json'],{cwd:home,env,timeout:30000})));
 for(const result of prepared)assert.equal(JSON.parse(result.stdout).services[0].status,'ready');
 const downloaded=requests;
 const offlineEnv={...env,CLI__SERVICE_BASE_URL:'http://127.0.0.1:1'};
 await writeFile(join(home,'rows.csv'),'Region,Amount\nEast,12\nWest,24\n');
 await writeFile(join(home,'report.sql'),'select "Region" from public.rows where "Amount" > $minimum');
 const queried=await run(binary,['query','rows.csv','--input','report.sql','--param','minimum=15','--json'],{cwd:home,env:offlineEnv,timeout:30000});
 assert.deepEqual(JSON.parse(queried.stdout).results[0].rows,[{Region:'West'}]);
 await writeFile(join(home,'rows.json'),JSON.stringify(Array.from({length:21},(_,n)=>({n}))));
 const first=JSON.parse((await run(binary,['query','rows.json','--json'],{cwd:home,env:offlineEnv,timeout:30000})).stdout).results[0];
 assert.equal(first.rows.length,20);assert.ok(first.next_cursor);
 const second=JSON.parse((await run(binary,['query','rows.json','--cursor',first.next_cursor,'--json'],{cwd:home,env:offlineEnv,timeout:30000})).stdout).results[0];
 assert.deepEqual(second.rows,[{n:20}]);assert.equal(second.next_cursor,null);
 await writeFile(join(home,'query.jsx'),'<Helmet><Value name="minimum" type="number" value={10} /><Query name="answer">{`select $minimum as value`}</Query></Helmet><p>Local SQL</p>');
 const declared=JSON.parse((await run(binary,['query','query.jsx','--name','answer','--param','minimum=42','--json'],{cwd:home,env:offlineEnv,timeout:30000})).stdout).results[0];
 assert.deepEqual(declared.rows,[{value:42}]);

 assert.equal((await readdir(home)).filter(name=>name.startsWith('afbin-sql-')).length,0,'extracted native files cleaned up');
 assert.match(await readFile(join(home,'afbin.1'),'utf8'),/^\.TH AFBIN 1/);
 assert.equal(requests,downloaded,'cached SQL must work without the release server');
 const manifest=JSON.parse(await readFile(binary+'.manifest.json','utf8'));
 for(const asset of [manifest.binary,manifest.skills])assert.equal(createHash('sha256').update(await readFile(resolve('dist',asset.file))).digest('hex'),asset.sha256);
 assert.deepEqual(gunzipSync(await readFile(binary+'.gz')),await readFile(binary));
 assert.equal(createHash('sha256').update(await readFile(binary+'.gz')).digest('hex'),manifest.binary.gzip.sha256);
 const sizes=JSON.parse(await readFile(binary+'.sizes.json','utf8'));assert.equal(sizes.coreInstalled,(await stat(binary)).size);assert.equal(sizes.coreDownload,(await stat(binary+'.gz')).size);
 console.log(JSON.stringify(sizes));
 console.log(`Release ${process.platform}/${process.arch}: offline core, corrupt package rejection, concurrent SQL prefetch, cached bound local SQL, gzip identity and asset checksums passed.`);
}finally{server.close();await rm(home,{recursive:true,force:true});}
