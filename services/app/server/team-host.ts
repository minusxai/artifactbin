/**
 * The team host runtime's entry (services/cli/scripts/build-host → dist/runtime/host.mjs): the CLI's
 * operator boot and local composition (services/cli/src/team-entry, team-application) with the app
 * host passed in, so the CLI never imports the server. Everything app-side loads only after
 * team-entry has installed the operator's environment.
 */
import {startTeamHost as startTeam} from '../../cli/src/team-entry';
import type {TeamOverrides} from '../../cli/src/team-config';

/** The team application over this app's host; tests compose it directly. */
export async function createTeamApplication(env:NodeJS.ProcessEnv,assets:string){
 // Intentional process-composition imports: app config captures the installed environment eagerly.
 const [{createTeamApplication:compose},{createAppHost}]=await Promise.all([import('../../cli/src/team-application'),import('./host')]);
 return compose(env,assets,createAppHost);
}

export function startTeamHost(configFile:string,assets:string,overrides:TeamOverrides={}):Promise<void>{
 return startTeam(configFile,assets,overrides,createTeamApplication);
}
