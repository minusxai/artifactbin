import type {DeploymentState} from '@artifactbin/contracts';
import { type SetupInstructionOptions } from '../skills/setup-instructions';

/** Only confirmed live deployment groups become recipient defaults. Group IDs never enter scripts. */
export function deploymentSetupOptions(state?:Pick<DeploymentState,'mode'|'setup_complete'|'default_group'>):Pick<SetupInstructionOptions,'groupHandle'|'setDefault'>{
 return state?.mode==='company'?{setDefault:true,...(state.setup_complete&&state.default_group?{groupHandle:state.default_group.handle}:{})}:{};
}
