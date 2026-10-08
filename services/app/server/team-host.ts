/**
 * The team host runtime's entry (services/cli/scripts/build-host → dist/runtime/host.mjs): the CLI's
 * operator boot (services/cli/src/team-entry) with the app composed in. The application module loads
 * only after team-entry has installed the operator's environment.
 */
import {startTeamHost as startTeam,type TeamApplication} from '../../cli/src/team-entry';
import type {TeamOverrides} from '../../cli/src/team-config';

// Intentional process-composition import: app config captures the installed environment eagerly.
const application:TeamApplication=async(env,runtime)=>(await import('./team-application')).createTeamApplication(env,runtime);

export function startTeamHost(configFile:string,assets:string,overrides:TeamOverrides={}):Promise<void>{
 return startTeam(configFile,assets,overrides,application);
}
