import {remoteWorkActive} from '@/lib/annotations/remote-reply';
import {it,expect} from 'vitest';
import { hasReplyText, remoteWorkLabel } from '@/lib/annotations';
const mention=(name:string,id:string)=>`[@${name}](/chat?session=${id.repeat(64)})`;
it('uses the latest human explicit targets, preserves them across agent replies and untagged humans, and deduplicates',()=>{
 const a=mention('claude','a');
 expect(hasReplyText(a+' ')).toBe(false);expect(hasReplyText(a+' please fix')).toBe(true);
});

it('shows refusal and unknown-readiness outcomes without claiming work began',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'claude',color:'blue' as const,phase:'queued' as const,updatedAt:'now'};
 expect(remoteWorkLabel({...work,reason:'queue_full'})).toMatch(/Queue full/);
 expect(remoteWorkLabel({...work,reason:'unauthorized'})).toMatch(/one of your agents/);
 expect(remoteWorkLabel({...work,activity:'unknown'})).toMatch(/readiness unknown/);
});

it('marks awaiting acknowledgment as pending while keeping acknowledged and completed labels distinct',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'codex',color:'blue' as const,updatedAt:'now'};
 expect(remoteWorkLabel({...work,phase:'delivered'})).toBe('Sent · awaiting acknowledgment…');
 expect(remoteWorkLabel({...work,phase:'acknowledged'})).toBe('Working');
 expect(remoteWorkLabel({...work,phase:'completed'})).toBe('Answered');
});

it('labels known terminal failure independently of agent readiness',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'codex',color:'blue' as const,updatedAt:'now',phase:'failed' as const};
 expect(remoteWorkLabel(work)).toBe('Execution failed · retry by mentioning again');
});

it.each(['online','offline'] as const)('explains capacity waiting even when comment connection is %s',connection=>{
 const work={id:'capacity',sessionId:'agent',artifactId:'doc',threadId:'thread',commentId:'comment',name:'agent',color:'blue' as const,phase:'dispatching' as const,updatedAt:'now',activity:'queued' as const,connection};
 expect(remoteWorkLabel(work)).toBe('Waiting for capacity');
 expect(remoteWorkLabel({...work,phase:'queued'})).toBe('Waiting for capacity');
 expect(remoteWorkLabel({...work,phase:'completed',connection:'online'})).toBe('Answered');
 expect(remoteWorkLabel({...work,connection:'stopped'})).toBe('Sending to agent · stopped');
});

it('keeps completed status concise even when the agent is listening',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'codex',color:'blue' as const,updatedAt:'now',phase:'completed' as const,activity:'listening' as const};
 expect(remoteWorkLabel(work)).toBe('Answered');
});

it('shows activity only during pending delivery or execution',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'codex',color:'blue' as const,updatedAt:'now',phase:'acknowledged' as const};
 for(const phase of ['queued','dispatching','delivered','acknowledged'] as const)expect(remoteWorkActive({...work,phase})).toBe(true);
 for(const phase of ['completed','failed','blocked','uncertain','unavailable','superseded'] as const)expect(remoteWorkActive({...work,phase})).toBe(false);
 expect(remoteWorkActive({...work,connection:'offline'})).toBe(false);
 expect(remoteWorkActive({...work,connection:'stopped'})).toBe(false);
 expect(remoteWorkActive({...work,reason:'queue_full'})).toBe(false);
});

it('reports cancellation as terminal without presenting it as failed or still working',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'afbin',color:'blue' as const,updatedAt:'now',phase:'cancelled' as const,connection:'online' as const};
 expect(remoteWorkLabel(work)).toBe('Cancelled');expect(remoteWorkActive(work)).toBe(false);
});
