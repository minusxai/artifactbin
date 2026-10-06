/** Offline ownership is advisory. Only authenticated server responses authorize. */
import {join,relative} from 'node:path';
import {loadConnection,observedCredentialAccount,withPrivateStateHome} from './config';
import {publicationCopies} from './workspace-rebind';
import {readState} from './state-access';
import {readLocalWorkspaceState,LOCAL_WORKSPACE_SCOPE} from './local-workspace';
import type {State,StateKind} from './state';
import type {Workspace} from './workspace';
const kinds:StateKind[]=['pending-request','pending-operation','staged-file','identity-move'];
function pending(store:State|null,scope:string){return kinds.flatMap(kind=>(store?.list<{account?:string;server?:string}>(scope,kind)??[]).map(row=>({kind,key:row.key,account:row.value.account??null,server:row.value.server??null})));}
export async function workspaceOwnership(workspace:Workspace,env?:NodeJS.ProcessEnv,server?:string){
 const copies=await publicationCopies(workspace),origin=workspace.tracking?.server??copies[0]?.manifest.server;const connection=await loadConnection(server??origin,workspace.home,env);
 const observed=connection?await observedCredentialAccount(connection,workspace.home,env):null;
 const home=await readState(workspace.home),portable=await readLocalWorkspaceState(workspace.root),publications=[];
 for(const copy of copies){
  const work=await withPrivateStateHome(copy.home,join(copy.home,'.artifactbin'),async()=>pending(await readState(copy.home),copy.manifest.root));
  publications.push({server:copy.manifest.server,account:copy.manifest.account,path:relative(workspace.root,copy.directory),pending:work});
 }
 return{observation:'last_observed',workspace:workspace.tracking?{server:origin,account:workspace.tracking.account}:null,credential:observed?{...observed,server:connection!.server}:null,publications,pending:[...pending(home,workspace.root),...pending(portable,LOCAL_WORKSPACE_SCOPE)],rebind_pending:!!portable?.get(LOCAL_WORKSPACE_SCOPE,'archive','workspace-rebind/current')};
}
