import {join} from 'node:path';
import {CliError} from './errors';
import {configDir} from './config';
interface DiagnosticWorkspace {root:string;home:string}
export function accountMismatch(expected:string|undefined,actual:string|undefined,server:string,workspace?:DiagnosticWorkspace,details:Record<string,unknown>={},pending=false):CliError{
 const root=workspace?.root;
 const pins=workspace?[join(configDir(workspace.home),'state.sqlite'),join(workspace.root,'.artifactbin','state.sqlite'),join(workspace.root,'.artifactbin','publications')]:[];
 return new CliError('workspace_account_mismatch',`Workspace${root?` ${root}`:''} on ${server} is pinned to ${expected??'an earlier account'}; authenticated account is ${actual??'not reported by this server'}.`,pending?'Recover the pending operation with its original account before changing any pins.':`Select the intended account with afbin auth --email <email> (plain afbin auth verifies saved credentials). To explicitly keep this directory under the current account, run afbin workspace rebind --account current; remote permissions still apply.`,{...details,http_status:409,server,expected_account:expected??null,actual_account:actual??null,...(root?{workspace_root:root,pin_locations:pins}:{}),...(pending?{recovery_blocked:true}:{})},3);
}
