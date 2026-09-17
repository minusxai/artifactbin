/**
 * The frame owns annotation geometry: the parent cannot inspect a sandboxed
 * document, so view-mode comment cards follow a signed, scroll-live layout
 * report rather than guessing from source paths.
 *
 * One rig for the three `lib/story-runtime/edit/__tests__/annotate-*.ui.test.ts`
 * files: the document under test, the pristine channel, and the session itself.
 */
import { vi } from 'vitest';
import { createFrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import { STORY_ANNOTATION_LAYOUT_MESSAGE, type StoryAnnotationsMessage } from '@/lib/story-runtime/contract';
import type { PristineChannel } from '@/lib/story-runtime/pristine';

export const NONCE = 'l'.repeat(32);
export const PIN = { id: 'ann_1', path: '0', key: 'anchor_1' };

/**
 * The live session, everything it posted, and the two knobs cases turn: the
 * anchor's y, and whether the document is being edited. Fields on an object
 * because an imported binding cannot be assigned to.
 */
export const env = {
  posted: [] as Array<Record<string, unknown>>,
  session: null as unknown as ReturnType<typeof createFrameAnnotateSession>,
  y: 220,
  editing: false,
};

export const channel = (): PristineChannel => ({
  nonce: NONCE,
  post: (message) => { env.posted.push(message as Record<string, unknown>); },
  innerHtmlOf: (el) => el.innerHTML,
  isParent: () => true,
  isFromParent: () => true,
});

export const state = (mode: StoryAnnotationsMessage['mode']): StoryAnnotationsMessage => ({
  type: 'mx:annotations', mode, pins: [PIN], openId: null, hoverId: null,
});

export const layouts = () => env.posted.filter((message) => message.type === STORY_ANNOTATION_LAYOUT_MESSAGE);

/** Pin an element's box, so a geometry assertion has numbers to check. */
export const rectOf = (el: Element, r: { x: number; y: number; width: number; height: number }) =>
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({
    x: r.x, y: r.y, top: r.y, left: r.x, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}),
  }));

/** Stand up the document and the session. Call from `beforeEach`. */
export function installAnnotateSession() {
  env.posted = [];
  env.y = 220;
  env.editing = false;
  document.body.innerHTML = '<nav class="mx-rail"><p data-mx-ast="0" data-annotation-anchor="anchor_1">Thumbnail copy</p></nav>'
    + '<main><p data-mx-ast="0" data-annotation-anchor="anchor_1">Revenue</p></main>';
  const preview = document.querySelector('.mx-rail p')!;
  vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() => ({
    x: 4, y: 18, top: 18, left: 4, width: 120, height: 20,
    right: 124, bottom: 38, toJSON: () => ({}),
  }));
  const anchor = document.querySelector('main p')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
    x: 40, y: env.y, top: env.y, left: 40, width: 300, height: 28,
    right: 340, bottom: env.y + 28, toJSON: () => ({}),
  }));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
  env.session = createFrameAnnotateSession({ win: window, channel: channel(), isEditing: () => env.editing });
}

/** Call from `afterEach`. */
export function disposeAnnotateSession() {
  env.session.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
}
