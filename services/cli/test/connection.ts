import {realpath} from 'node:fs/promises';
import {stateFor} from '../src/state-access';
import {HOME_SCOPE} from '../src/state';
import {saveConnection,saveDefaultServer,type Connection} from '../src/config';

/** Workflow fixtures explicitly select their fake host. A real login never selects a default. */
export async function saveTestConnection(connection:Connection,home:string,env:NodeJS.ProcessEnv={}):Promise<void>{
 await saveDefaultServer(connection.server,home,env);
 await saveConnection(connection,home,env);
}

/** Sync tests start with server-issued IDs cached; reservation HTTP is covered by identity-workflow. */
export async function seedIdentityPool(home:string,root:string,ids:string[],account='usr_one',server='https://example.com'):Promise<void>{
 root=await realpath(root);const state=await stateFor(home);
 state.transaction(()=>{
  state.put(root,'workspace',root,{server,account});
  state.put(HOME_SCOPE,'identity-pool',JSON.stringify([server,account]),{ids:[...ids,...Array.from({length:100-ids.length},(_,i)=>'S'+String(i).padStart(5,'0'))]});
 });
}
