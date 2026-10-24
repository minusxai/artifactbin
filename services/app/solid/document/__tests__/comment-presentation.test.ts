import {expect,it} from 'vitest';
import {needsCommentPresentation,type CommentPresentation} from '../comment-presentation';
const empty:CommentPresentation={canRead:true,active:false,linked:false,railOpen:false,composing:false,picking:false,openCount:0,liveCount:0};
it('keeps an empty readable document free of the discussion UI until requested',()=>{expect(needsCommentPresentation(empty)).toBe(false)});
it.each([{picking:true},{linked:true},{active:true},{railOpen:true},{composing:true},{openCount:1},{liveCount:1}])('shows admitted discussion when needed: %j',change=>{expect(needsCommentPresentation({...empty,...change})).toBe(true)});
it('never mounts discussion after read admission is revoked',()=>{expect(needsCommentPresentation({...empty,active:true,picking:true,canRead:false,railOpen:true,openCount:1,liveCount:1})).toBe(false)});
