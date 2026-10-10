import type {DeploymentState} from '@artifactbin/contracts';
import {setupSelectionFlags,type SetupInstructionOptions} from '../platform/setup-instructions';

/** Only confirmed live deployment groups become recipient defaults. Group IDs never enter scripts. */
export function deploymentSetupOptions(state?:Pick<DeploymentState,'mode'|'setup_complete'|'default_group'>):Pick<SetupInstructionOptions,'groupHandle'|'setDefault'>{
 return state?.mode==='company'?{setDefault:true,...(state.setup_complete&&state.default_group?{groupHandle:state.default_group.handle}:{})}:{};
}
/** Render the existing installer with the same selection used in copied/served instructions. */
export function renderSetupInstaller(source:string,origin:string,state:DeploymentState,language:'sh'|'powershell'):string{
 const options=deploymentSetupOptions(state);
 const quote=(value:string)=>`'${language==='powershell'?value.replaceAll("'","''"):value.replaceAll("'",`'"'"'`)}'`;
 if(language==='powershell')return source.replace(/^\$Origin = '[^']*'$/m,()=>`$Origin = ${quote(origin)}`).replace(/^npx\.cmd --yes @afbin\/cli@latest setup --server \$Origin$/m,()=>`npx.cmd --yes @afbin/cli@latest setup --server $Origin${setupSelectionFlags(options,true)}`);
 const addressed=source.replace(/^ {2}origin=''$/m,()=>`  origin=${quote(origin)}`);
 if(!options.setDefault)return addressed;
 // Additional argv is passed to the inner bash as positional arguments, never interpolated code.
 return addressed.replaceAll(`setup --server "$2"' bash "$afbin_node_setup" "$origin"`,`setup --server "$2" "\${@:3}"' bash "$afbin_node_setup" "$origin"${setupSelectionFlags(options)}`);
}
