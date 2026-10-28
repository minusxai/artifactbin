import {expect,test} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRemoteContextBridge} from '../src/remote-context-bridge';
import {runSkillCommand} from '../src/skill-command';

test.skipIf(process.platform==='win32')('runs a skill script and readiness with the bridged session, never the caller\'s environment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'af-skill-command-')),skill=join(root,'skill'),proof=join(root,'env.json');
 const ready:Array<{auth?:string;body:string}>=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;ready.push({auth:req.headers.authorization,body});res.setHeader('Content-Type','application/json');res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const bridge=await createRemoteContextBridge({id:'mxmx_test_session',proof:'mxmx_test_proof',home:join(root,'.artifactbin'),server:origin,connection:{server:origin,token:'mxmx_test_token'}});
 try{
  await mkdir(join(skill,'scripts'),{recursive:true});
  await writeFile(join(skill,'scripts','comment.mjs'),`import {writeFileSync} from 'node:fs';const e=process.env;writeFileSync(${JSON.stringify(proof)},JSON.stringify({args:process.argv.slice(2),url:e.ARTIFACTBIN_URL,token:e.ARTIFACTBIN_TOKEN,session:e.ARTIFACTBIN__REMOTE_SESSION,proof:e.ARTIFACTBIN__REMOTE_PROOF,home:e.ARTIFACTBIN_HOME}));process.exit(3);\n`);
  const env={PATH:process.env.PATH};
  expect(await runSkillCommand([bridge.path,'mxmx_test_session',skill,'comment','list','abc123','--json'],{env})).toBe(3);
  expect(JSON.parse(await readFile(proof,'utf8'))).toEqual({args:['list','abc123','--json'],url:origin,token:'mxmx_test_token',session:'mxmx_test_session',proof:'mxmx_test_proof',home:join(root,'.artifactbin')});
  expect(await runSkillCommand([bridge.path,'mxmx_test_session',skill,'ready'],{env})).toBe(0);
  expect(ready).toEqual([{auth:'Bearer mxmx_test_token',body:JSON.stringify({type:'ready',proof:'mxmx_test_proof'})}]);
  expect(await runSkillCommand([bridge.path,'mxmx_test_session',skill,'missing'],{env})).toBe(2);
  expect(await runSkillCommand([bridge.path,'mxmx_test_session',skill,'../comment'],{env})).toBe(2);
  await expect(runSkillCommand([bridge.path,'another_session',skill,'comment'],{env})).rejects.toThrow();
 }finally{await bridge.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
