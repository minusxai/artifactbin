/**
 * THE HOSTED AGENT'S SKILL EXECUTABLE. runHostedAgent writes `<state>/artifactbin`, which execs this runtime as
 *
 *   node <entry> --internal-skill-command <bridge> <session> <skill> <script> [args...]
 *
 * The harness may run tools without the session's environment, so the session's server, grant and proof come from
 * the memory-only context bridge (remote-context-bridge), never from a file. `ready` tells the relay the agent is
 * listening; any other script runs `<skill>/scripts/<script>.mjs` with that context in its environment, where the
 * skill's own scripts read the grant (ARTIFACTBIN_URL, ARTIFACTBIN_TOKEN) and comment replies carry the proof.
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readRemoteContextBridge} from './remote-context-bridge';
import {restoreRemoteContext} from './config';

export const SKILL_COMMAND_ARG='--internal-skill-command';

/** Runs one skill command; resolves to the exit code. `argv` is everything after SKILL_COMMAND_ARG. */
export async function runSkillCommand(argv:string[],options:{env?:NodeJS.ProcessEnv;fetch?:typeof fetch}={}):Promise<number>{
 const [bridge,session,skill,script,...args]=argv;
 if(!bridge||!session||!skill||!script||!/^[a-z][a-z-]{0,39}$/.test(script)){process.stderr.write('Usage: artifactbin <script> [args...]; scripts are the author skill\'s, for example read, publish, comment.\n');return 2;}
 const context=await readRemoteContextBridge(bridge,session);
 const env={...(options.env??process.env)};restoreRemoteContext(context,env);
 if(script==='ready'){
  const response=await (options.fetch??fetch)(new URL(`/api/remote/sessions/${encodeURIComponent(session)}`,context.server),{method:'POST',signal:AbortSignal.timeout(30000),
   headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.ARTIFACTBIN_TOKEN}`},body:JSON.stringify({type:'ready',proof:context.proof})});
  if(!response.ok){process.stderr.write(`Readiness was refused (HTTP ${response.status}).\n`);return 1;}
  process.stdout.write(JSON.stringify({id:session,status:'listening'})+'\n');return 0;
 }
 const file=join(skill,'scripts',`${script}.mjs`);
 if(!existsSync(file)){process.stderr.write(`The author skill has no ${script} script.\n`);return 2;}
 return await new Promise<number>(resolve=>{
  const child=spawn(process.execPath,[file,...args],{env,stdio:'inherit'});
  child.once('error',()=>resolve(1));
  child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));
 });
}
