import {it,expect} from 'vitest';
import {replyMentionPrefix,hasReplyText} from '../remote-reply';
const mention=(name:string,id:string)=>`[@${name}](/chat?session=${id.repeat(64)})`;
it('uses the latest human explicit targets, preserves them across agent replies and untagged humans, and deduplicates',()=>{
 const a=mention('claude','a'),b=mention('pi','b');
 const thread=[{body:a+' '+a,author:{kind:'human'}},{body:b,author:{kind:'agent'}},{body:'thanks',author:{kind:'human'}}];
 expect(replyMentionPrefix(thread)).toBe(a+' ');
 expect(replyMentionPrefix([...thread,{body:b,author:{kind:'human'}}])).toBe(b+' ');
 expect(hasReplyText(a+' ')).toBe(false);expect(hasReplyText(a+' please fix')).toBe(true);
});
