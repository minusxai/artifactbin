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

import {REMOTE_COLOR_CSS} from '../../../contracts/src/remote';
it('agent name colors meet normal-text contrast on light and dark comment surfaces',()=>{
 const luminance=(hex:string)=>{const channels=hex.match(/[a-f0-9]{2}/gi)!.map(s=>parseInt(s,16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
 const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
 for(const css of Object.values(REMOTE_COLOR_CSS)){
  const [light,dark]=css.match(/#[a-f0-9]{6}/gi)!;
  expect(contrast(light,'#ffffff')).toBeGreaterThanOrEqual(4.5);
  expect(dark).toBeDefined();expect(contrast(dark,'#202020')).toBeGreaterThanOrEqual(4.5);
 }
});

it('marks awaiting acknowledgment as pending while keeping acknowledged and completed labels distinct',()=>{
 const work={id:'request',sessionId:'session',artifactId:'doc',threadId:'thread',commentId:'comment',name:'codex',color:'blue' as const,updatedAt:'now'};
 expect(remoteWorkLabel({...work,phase:'delivered'})).toBe('Sent · awaiting acknowledgment…');
 expect(remoteWorkLabel({...work,phase:'acknowledged'})).toBe('Working');
 expect(remoteWorkLabel({...work,phase:'completed'})).toBe('Answered');
});
