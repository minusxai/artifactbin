import {realpath} from 'node:fs/promises';
import {stateFor} from '../src/state-access';
import {HOME_SCOPE} from '../src/state';
import {saveConnection,saveDefaultServer,type Connection} from '../src/config';
import {serverIdentity} from '../src/server-identity';

/** Workflow fixtures explicitly select their fake host. A real login never selects a default. */
export async function saveTestConnection(connection:Connection,home:string,env:NodeJS.ProcessEnv={}):Promise<void>{
 await saveDefaultServer(connection.server,home,env);
 await saveConnection(connection,home,env);
 await settleIdentity(connection.server,home,env);
}

/**
 * THE FAKE HOST HAS ALREADY ANSWERED: one deployment, one address, no aliases.
 *
 * Every command now asks the selected origin which addresses it answers at, once per private
 * state directory (services/cli/src/server-identity). A fixture that stands in for a whole
 * server states the answer here, through the real resolver and its real cache, so a workflow
 * test keeps asserting the requests its COMMAND makes. The discovery request itself — cold
 * cache, both directions of the trust rule, an older server that 404s — is what
 * test/server-aliases.test.ts and the CLI publication gate exist to cover.
 */
export async function settleIdentity(server:string,home:string,env:NodeJS.ProcessEnv={}):Promise<void>{
 await serverIdentity(server,{home,env,fetch:(async()=>new Response('not found',{status:404})) as typeof fetch});
}

/** Sync tests start with server-issued IDs cached; reservation HTTP is covered by identity-workflow. */
export async function seedIdentityPool(home:string,root:string,ids:string[],account='usr_one',server='https://example.com'):Promise<void>{
 root=await realpath(root);const state=await stateFor(home);
 state.transaction(()=>{
  state.put(root,'workspace',root,{server,account});
  state.put(HOME_SCOPE,'identity-pool',JSON.stringify([server,account]),{ids:[...ids,...Array.from({length:100-ids.length},(_,i)=>'S'+String(i).padStart(5,'0'))]});
 });
}
