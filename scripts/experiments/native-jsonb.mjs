/** Disposable native PostgreSQL runner. Never connects to an existing database. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const cluster=mkdtempSync(join(tmpdir(),'artifact-jsonb-migration-')),data=join(cluster,'data');
execFileSync('initdb',['-D',data,'-U','probe','--auth=trust','--no-locale','-E','UTF8'],{stdio:'ignore'});
execFileSync('pg_ctl',['-D',data,'-l',join(cluster,'log'),'-o',`-k ${cluster} -p 5491 -c listen_addresses=''`,'-w','start'],{stdio:'ignore'});
try{
 const child=spawn(process.execPath,['--import','tsx',resolve(process.argv.find(x=>x.startsWith('--worker='))?.slice(9)??'scripts/experiments/jsonb-operations-check.mjs'),...process.argv.slice(2).filter(x=>!x.startsWith('--worker='))],{stdio:'inherit',env:{...process.env,NODE_ENV:'development',DATABASE_URL:`postgresql://probe@localhost:5491/postgres?host=${encodeURIComponent(cluster)}`,APP__PUBLIC_BASE_URL:'http://localhost:5460',EVENTS__SERVICE_URL:'',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:''}});
 const code=await new Promise((resolve,reject)=>{child.on('exit',code=>resolve(code??1));child.on('error',reject);});if(code)process.exitCode=code;
}finally{execFileSync('pg_ctl',['-D',data,'-m','fast','-w','stop'],{stdio:'ignore'});rmSync(cluster,{recursive:true,force:true});}
