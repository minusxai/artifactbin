import {it,expect} from 'vitest';
import {replyMentionPrefix,hasReplyText,remoteWorkLabel} from '../remote-reply';
const mention=(name:string,id:string)=>`[@${name}](/chat?session=${id.repeat(64)})`;
it('uses the latest human explicit targets, preserves them across agent replies and untagged humans, and deduplicates',()=>{
 const a=mention('claude','a'),b=mention('pi','b');
 const thread=[{body:a+' '+a,author:{kind:'human'}},{body:b,author:{kind:'agent'}},{body:'thanks',author:{kind:'human'}}];
 expect(replyMentionPrefix(thread)).toBe(a+' ');
 expect(replyMentionPrefix([...thread,{body:b,author:{kind:'human'}}])).toBe(b+' ');
 expect(hasReplyText(a+' ')).toBe(false);expect(hasReplyText(a+' please fix')).toBe(true);
});

it('shows refusal and unknown-readiness outcomes without claiming work began',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'claude',color:'blue' as const,phase:'queued' as const,updatedAt:'now'};
 expect(remoteWorkLabel({...work,reason:'queue_full'})).toMatch(/Queue full/);
 expect(remoteWorkLabel({...work,reason:'unauthorized'})).toMatch(/one of your agents/);
 expect(remoteWorkLabel({...work,activity:'unknown'})).toMatch(/readiness unknown/);
});
