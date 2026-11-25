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
