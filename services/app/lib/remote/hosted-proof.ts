import {createHash,createHmac} from 'node:crypto';
import {type Actor,type HostedRemoteAgent} from '@artifactbin/contracts';
import {hostedAgentCallbackKey,verifyActor} from '@artifactbin/utils';

/** The one configured URL hosted agent and its callback key: set at boot, read by remote agents and the runner's callback operation. */
let external:{agent:HostedRemoteAgent;key:string}|undefined;
export function setExternalHostedAgent(agent:HostedRemoteAgent,secret:string){external={agent,key:hostedAgentCallbackKey(secret)};}
export function clearExternalHostedAgent(){external=undefined;}
/** The ordinary proxy actor signature is deliberately insufficient: only this agent's callback key verifies. */
export const verifyExternalHostedCallback=(header:string|null):Actor|null=>external?verifyActor(header,external.key):null;
/** Only an explicitly configured URL service gets this callback capability. */
export function externalHostedProof(owner:string,id:string):string|undefined {
 if(!external?.agent.owns(owner,id))return;
 return createHmac('sha256',external.key).update(JSON.stringify([owner,id])).digest('hex');
}
export const externalHostedProofHash=(owner:string,id:string)=>{const proof=externalHostedProof(owner,id);return proof?createHash('sha256').update(proof).digest('hex'):undefined;};
