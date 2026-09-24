/** Native PostgreSQL benchmark launcher. Owns only a disposable cluster and child environment. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const cluster=mkdtempSync(join(tmpdir(),'artifact-row-bench-'));const data=join(cluster,'data');
execFileSync('initdb',['-D',data,'-U','probe','--auth=trust','--no-locale','-E','UTF8'],{stdio:'ignore'});
execFileSync('pg_ctl',['-D',data,'-l',join(cluster,'log'),'-o',`-k ${cluster} -p 5490 -c listen_addresses=''`,'-w','start'],{stdio:'ignore'});
try {
 const worker=process.argv.includes('--validity')?'validated-operations-worker.mjs':'single-row-worker.mjs';
 const child=spawn(process.execPath,['--import','tsx',resolve('scripts/experiments',worker),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,NODE_ENV:'development',DATABASE_URL:`postgresql://probe@localhost:5490/postgres?host=${encodeURIComponent(cluster)}`,APP__PUBLIC_BASE_URL:'http://localhost:5430',EVENTS__SERVICE_URL:'',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:''}});
 const code=await new Promise((resolve,reject)=>{child.on('exit',code=>resolve(code??1));child.on('error',reject);});if(code)process.exitCode=code;
} finally {execFileSync('pg_ctl',['-D',data,'-m','fast','-w','stop'],{stdio:'ignore'});rmSync(cluster,{recursive:true,force:true});}
