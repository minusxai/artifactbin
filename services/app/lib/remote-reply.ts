import type {RemoteWork} from '../../contracts/src/remote';
import {sessionMentions} from './session-mentions';
/** The latest human explicit targets are defaults, never inferred from an agent reply. */
export function replyMentionPrefix(thread:ReadonlyArray<{body:string;author:{kind:string}}>):string{
 for(let i=thread.length-1;i>=0;i--){const c=thread[i]!;if(c.author.kind!=='human')continue;
  const mentions=new Map<string,string>();for(const match of sessionMentions(c.body))mentions.set(match[2]!,match[0]);
  if(mentions.size)return [...mentions.values()].join(' ')+' ';
 }
 return '';
}
export function hasReplyText(body:string):boolean{let text=body;for(const match of sessionMentions(body))text=text.replace(match[0],'');return !!text.trim();}

export function remoteWorkLabel(work:RemoteWork):string{
 if(work.reason==='queue_full')return 'Queue full · mention again after pending work finishes';
 if(work.reason==='unauthorized')return 'Unavailable · mention one of your agents';
 const phase=({superseded:'Follow-up received',dispatching:'Sending to agent',queued:'Queued',delivered:'Sent · awaiting acknowledgment…',acknowledged:'Working',completed:'Answered',blocked:'Needs your input',uncertain:'Delivery uncertain · check terminal',unavailable:'Agent unavailable'})[work.phase];
 if(work.connection==='offline')return phase+' · offline';
 if(work.connection==='stopped')return phase+' · stopped';
 if(work.phase==='queued'&&work.activity==='unknown')return phase+' · readiness unknown, check terminal';
 if(work.phase==='queued'&&work.activity==='starting')return phase+' · loading context';
 if(work.phase==='completed'&&work.activity==='listening')return phase+' · listening';
 return phase;
}
