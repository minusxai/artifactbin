/** CI-only: the same remote-host conformance against a packaged foreground OSS team server. */
import {spawn} from 'node:child_process';
import {stopTeamHost} from './team-host-process.mjs';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const executable=resolve(process.argv[2]??'dist/afbin.mjs');
const root=await mkdtemp(join(tmpdir(),'afbin-team-product-')),operator=join(root,'team'),home=join(root,'client');
await mkdir(operator);await mkdir(home);
const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const origin='http://app.lvh.me:'+port,outbox=join(operator,'mail.jsonl');
const env={...process.env,HOME:home,USERPROFILE:home,ARTIFACTBIN_SKILLS:'off',ARTIFACTBIN_HOME:join(operator,'data/runtime'),CLI__AUTO_UPDATE:'0',EMAIL__DEV_OUTBOX_PATH:outbox};
delete env.ARTIFACTBIN_TOKEN;delete env.ARTIFACTBIN_URL;
const command=process.execPath,prefix=[executable];
async function completed(program,args,options={}){
 const child=spawn(program,args,{env,cwd:root,stdio:'inherit',...options});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),180000);
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Acceptance command exited '+code)));});}finally{clearTimeout(timeout);}
}
let server,log='';
try{
 // SQL is carried by npm; Chromium preparation uses Playwright, with no client login/config.
 for(const name of ['sql','chromium'])await completed(command,[...prefix,'setup','--service',name,'--json']);
 const file=join(operator,'server.env');
 await writeFile(file,`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=${origin}\nAUTH__SECRET=${randomBytes(32).toString('hex')}\nEMAIL__DEV_OUTBOX_PATH=${outbox}\n`,{mode:0o600});
 server=spawn(command,[...prefix,'serve','--config',file,'--dir',operator,...(process.env.CONFORMANCE__DB_URL?['--db-url',process.env.CONFORMANCE__DB_URL]:[])],{env,cwd:root,detached:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log=(log+chunk).slice(-8000);});
 let ready=false;
 for(let n=0;n<180;n++){
  if(server.exitCode!==null)throw new Error('Team host exited before readiness: '+log);
  try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await sleep(500);
 }
 if(!ready)throw new Error('Team host failed readiness: '+log);
 const gate=fileURLToPath(new URL('../../../scripts/gate-cli-conformance.mjs',import.meta.url));
 await completed(process.execPath,[gate,origin],{env:{...env,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH??join(homedir(),'.cache/ms-playwright'),CONFORMANCE__CLI:executable}});
}catch(error){console.error(log);throw error;}finally{
 await stopTeamHost(server);
await rm(root,{recursive:true,force:true});
}
console.log('Packaged OSS team host passed the existing remote-host conformance suite and cleanup.');
