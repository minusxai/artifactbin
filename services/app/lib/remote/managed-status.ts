import type {RemoteActivity} from '../../../contracts/src/remote';

const terminalRuns=new Set(['completed','failed','cancelled','interrupted','ended']);
export const isTerminalManagedRun=(status:string)=>terminalRuns.has(status);

/** Project durable runner lifecycle into the roster without probing terminal readiness. */
export function managedRunRosterStatus(status:string,active:boolean,activity?:RemoteActivity):{online:boolean;activity:RemoteActivity}{
 if(isTerminalManagedRun(status))return {online:false,activity:'stopped'};
 if(!active||activity==='stopping')return {online:false,activity:'stopping'};
 if(status==='queued')return {online:false,activity:'starting'};
 if(status==='running')return {online:true,activity:'working'};
 return {online:false,activity:'unknown'};
}
