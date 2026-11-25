import {expect,it} from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import { createReaderDiscussion } from '../create-reader-discussion';
import {commentLink,needsCommentPresentation,type CommentPresentation} from '../comment-presentation';
const empty:CommentPresentation={canRead:true,active:false,linked:false,railOpen:false,composing:false,picking:false,openCount:0,liveCount:0};
it('keeps an empty readable document free of the discussion UI until requested',()=>{expect(needsCommentPresentation(empty)).toBe(false)});
it.each([{picking:true},{linked:true},{active:true},{railOpen:true},{composing:true},{openCount:1},{liveCount:1}])('shows admitted discussion when needed: %j',change=>{expect(needsCommentPresentation({...empty,...change})).toBe(true)});
it('never mounts discussion after read admission is revoked',()=>{expect(needsCommentPresentation({...empty,active:true,picking:true,canRead:false,railOpen:true,openCount:1,liveCount:1})).toBe(false)});

it('projects a decoded reply target ahead of a thread target', () => {
  expect(commentLink('?thread=parent&comment=reply%2F1')).toEqual({ target: 'reply/1', requested: true, takesFocus: true });
  expect(commentLink('?thread=parent')).toEqual({ target: 'parent', requested: true, takesFocus: true });
});

it('separates a real link from an address that just reserves editor focus', () => {
  expect(commentLink('?intent=comment')).toEqual({ target: null, requested: false, takesFocus: true });
  expect(commentLink('?comment=')).toEqual({ target: '', requested: false, takesFocus: true });
});

it('prefers the layer over live rows, then deferred and served counts, even when a source is empty', () => {
  const open: AnnotationWire = {
    id: 'open', status: 'open', orphaned: true, anchor: null, anchor_version: null, snippet: '',
    quote: null, quote_found: null, range: null, thread: [], created_at: '', resolved_at: null,
  };
  const resolved: AnnotationWire = { ...open, id: 'resolved', status: 'resolved' };
  createRoot((dispose) => {
    try {
      const [servedCount, setServedCount] = createSignal<number>();
      const [deferredCount, setDeferredCount] = createSignal<number>();
      const discussion = createReaderDiscussion({
        reader: () => ({ role: 'viewer', accountSession: false, archived: false }),
        railOpen: () => false, onRailOpenChange: () => {}, servedCount, deferredCount,
      });
      expect(discussion.openCount()).toBe(0);
      setServedCount(4);
      expect(discussion.openCount()).toBe(4);
      setDeferredCount(2);
      expect(discussion.openCount()).toBe(2);
      setDeferredCount(0);
      expect(discussion.openCount()).toBe(0);
      setDeferredCount(2);
      discussion.setLiveAnnotations([]);
      expect(discussion.openCount()).toBe(0);
      discussion.setLiveAnnotations([open, resolved]);
      expect(discussion.openCount()).toBe(1);
      expect(discussion.openRows()).toEqual([open]);
      discussion.setLayerAnnotations([resolved]);
      expect(discussion.openCount()).toBe(0);
      expect(discussion.openRows()).toEqual([]);
    } finally {
      dispose();
    }
  });
});
