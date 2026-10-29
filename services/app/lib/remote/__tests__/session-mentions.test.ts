import {expect,it} from 'vitest';
import {sessionMentions} from '..';
import {isSessionMentionHref} from '../session-mentions';
const uuid='0123abcd-4567-89ab-cdef-0123456789ab',sha='a'.repeat(64);
it('captures the visible label and the session id of every legacy UUID and SHA-256 mention',()=>{
 const text=`Ask [@Alex](/chat?session=${uuid}) and [@Build bot](/chat?session=${sha}).`;
 expect([...sessionMentions(text)].map(match=>[match[1],match[2]])).toEqual([['@Alex',uuid],['@Build bot',sha]]);
});
it('refuses malformed ids, labels without @, multi-line labels and extra URL components',()=>{
 for(const text of [`[@A](/chat?session=${uuid.toUpperCase()})`,`[@A](/chat?session=${'a'.repeat(63)})`,`[A](/chat?session=${sha})`,`[@A\nB](/chat?session=${sha})`,`[@A](/chat?session=${sha}&x=1)`,`[@A](/other?session=${sha})`])
  expect([...sessionMentions(text)]).toEqual([]);
});
it('gives every caller a fresh iterator',()=>{
 const text=`[@A](/chat?session=${sha})`;
 const first=sessionMentions(text);expect([...first]).toHaveLength(1);expect([...first]).toHaveLength(0);
 expect([...sessionMentions(text)]).toHaveLength(1);
});
it('admits only the exact internal session route as a mention link',()=>{
 expect(isSessionMentionHref(`/chat?session=${uuid}`)).toBe(true);
 expect(isSessionMentionHref(`/chat?session=${sha}`)).toBe(true);
 for(const href of [`/chat?session=${sha}&next=/x`,`/chat?session=${sha}#top`,`https://evil.example/chat?session=${sha}`,`/chat/?session=${sha}`,`/chat?session=${sha.slice(1)}`,''])
  expect(isSessionMentionHref(href)).toBe(false);
});
