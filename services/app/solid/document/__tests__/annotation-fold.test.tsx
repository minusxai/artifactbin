/* @jsxImportSource solid-js */
/**
 * FOLDS, RESOLVED CONTEXT AND TIMESTAMPS (components/__tests__/annotation-fold.ui.test.tsx and
 * annotation-resolved-context.ui.test.tsx, in Solid).
 *
 * A long reply must not push the short one off the rail: a body over ten LAID-OUT lines clamps
 * itself (never the newest comment of a thread just opened), the author line folds one comment, the
 * chevron folds a conversation. The fold is this viewer's — localStorage, never the wire or the URL.
 * A resolved thread reads as resolved; selecting one highlights its passage, or shows the original
 * words when the document no longer can; one resolved elsewhere counts down on its marker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import type { AnnotationWire } from '@/lib/annotations/store';
import { FOLD_STORAGE_KEY } from '@/lib/annotations/comment-folds';
import { STORY_ANNOTATION_LAYOUT_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentTimestamp } from '../AnnotationPreview';
import { ANN, RESOLVED, fetchCalls, flush, installAnnotationFetch, knobs, layer } from './annotation-rig';

const LONG_BODY = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the agent's answer`).join('\n');
const SHORT_REPLY = 'thanks — shipping it';
const human = (id: string, body: string, at: string) => ({ id, body, author: { kind: 'human' as const, label: 'vivek', transport: 'browser' as const, user_id: 'usr_vivek', image: null }, created_at: at });
const agent = (id: string, body: string, at: string) => ({ id, body, author: { kind: 'agent' as const, label: 'Claude Code', transport: 'mcp' as const, user_id: null, image: null }, created_at: at });
const LONG_THEN_SHORT: AnnotationWire = { ...ANN, thread: [agent('ann_1', LONG_BODY, '2026-09-01T00:00:00Z'), human('ann_2', SHORT_REPLY, '2026-09-01T01:00:00Z')] };
const SHORT_THEN_LONG: AnnotationWire = { ...ANN, thread: [human('ann_1', 'why is the cap 5?', '2026-09-01T00:00:00Z'), agent('ann_2', LONG_BODY, '2026-09-01T01:00:00Z')] };
const OLD: AnnotationWire = { ...ANN, id: 'ann_r', status: 'resolved', snippet: 'an older figure', thread: [human('ann_r', 'stale number here', '2026-08-01T00:00:00Z')], resolved_at: '2026-08-02T00:00:00Z' };

/** jsdom lays nothing out: one line per rendered block and line break, twenty pixels each. */
let scrollHeight: PropertyDescriptor | undefined;
beforeEach(() => {
  installAnnotationFetch();
  knobs.open = [LONG_THEN_SHORT];
  knobs.resolved = [];
  localStorage.clear();
  scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get(this: Element) { return (this.querySelectorAll('p, pre, ul, blockquote, br').length || 1) * 20; } });
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
});

async function openRailThread() {
  const view = layer({ railOpen: true });
  await flush();
  fireEvent.click(await screen.findByLabelText('Open annotation thread'));
  await flush();
  return { thread: screen.getByLabelText('Annotation thread'), view };
}

describe('a body longer than ten lines folds itself', () => {
  it('the long agent answer clamps with "show more (N lines)" and opens on click', async () => {
    const { thread } = await openRailThread();
    expect(thread.textContent).toContain(SHORT_REPLY);
    const control = within(thread).getByLabelText('Show whole comment');
    expect(control.textContent).toMatch(/show more \(40 lines\)/);
    const clamped = thread.querySelector<HTMLElement>('[data-folded-body="clamped"]')!;
    expect(clamped).toBeTruthy();
    expect(clamped.style.maxHeight).toBe('200px');
    expect(clamped.textContent).toContain('line 40 of the agent');
    fireEvent.click(control);
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeNull();
    const back = within(thread).getByLabelText('Show less of comment');
    expect(back.textContent).toMatch(/show less/);
    fireEvent.click(back);
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeTruthy();
  });

  it('the NEWEST comment of a thread just opened is never folded', async () => {
    knobs.open = [SHORT_THEN_LONG];
    const { thread } = await openRailThread();
    expect(thread.textContent).toContain('line 40 of the agent');
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeNull();
    expect(within(thread).queryByLabelText('Show whole comment')).toBeNull();
  });
});

describe('a comment folds to its author line', () => {
  it('the author line toggles the body away, keeping identity, transport, time and one line', async () => {
    const { thread } = await openRailThread();
    const toggle = within(thread).getAllByLabelText('Collapse comment')[0]!;
    expect(toggle.getAttribute('role')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    const collapsed = within(thread).getByLabelText('Expand comment');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    expect(within(collapsed).getByText('Claude Code')).toBeTruthy();
    expect(within(thread).getByLabelText('Transport MCP')).toBeTruthy();
    expect(thread.textContent).toContain("line 1 of the agent's answer");
    expect(thread.textContent).not.toContain('line 2 of the agent');
    expect(thread.textContent).toContain(SHORT_REPLY);
    fireEvent.click(collapsed);
    expect(thread.textContent).toContain('line 2 of the agent');
  });

  it('Enter and Space work the toggle from the keyboard', async () => {
    const { thread } = await openRailThread();
    fireEvent.keyDown(within(thread).getAllByLabelText('Collapse comment')[0]!, { key: 'Enter' });
    expect(thread.textContent).not.toContain('line 2 of the agent');
    fireEvent.keyDown(within(thread).getByLabelText('Expand comment'), { key: ' ' });
    expect(thread.textContent).toContain('line 2 of the agent');
  });

  it('the fold survives a remount — it is remembered, not held in a render', async () => {
    const { thread, view } = await openRailThread();
    fireEvent.click(within(thread).getAllByLabelText('Collapse comment')[0]!);
    expect(JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY)!)).toEqual({ doc1: { threads: [], comments: ['ann_1'] } });
    view.unmount();
    layer({ railOpen: true });
    await flush();
    fireEvent.click(await screen.findByLabelText('Open annotation thread'));
    const again = screen.getByLabelText('Annotation thread');
    expect(within(again).getByLabelText('Expand comment')).toBeTruthy();
    expect(again.textContent).not.toContain('line 2 of the agent');
  });
});

describe('a whole thread folds to one line', () => {
  it('the chevron folds the conversation to its snippet, one line and a reply count', async () => {
    const { thread } = await openRailThread();
    const chevron = within(thread).getByLabelText('Collapse thread');
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron);
    const folded = screen.getByLabelText('Annotation thread');
    expect(within(folded).getByLabelText('Expand thread')).toBeTruthy();
    expect(folded.textContent).toContain('Revenue grew 40%');
    expect(folded.textContent).toContain("line 1 of the agent's answer");
    expect(folded.textContent).toContain('1 reply');
    expect(folded.textContent).not.toContain('line 2 of the agent');
    expect(folded.textContent).not.toContain(SHORT_REPLY);
    expect(within(folded).queryByLabelText('Reply to annotation')).toBeNull();
  });

  it('a pin click unfolds the thread it opens — the answer must be on screen', async () => {
    const { thread, view } = await openRailThread();
    fireEvent.click(within(thread).getByLabelText('Collapse thread'));
    expect(screen.getByLabelText('Annotation thread').textContent).not.toContain(SHORT_REPLY);
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: 'ann_1' });
    const reopened = screen.getByLabelText('Annotation thread');
    expect(within(reopened).getByLabelText('Collapse thread')).toBeTruthy();
    expect(reopened.textContent).toContain(SHORT_REPLY);
    expect(JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY)!).doc1.threads).toEqual([]);
  });
});

describe('the fold is this viewer’s, and travels nowhere', () => {
  it('no request body and no URL ever carries it', async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const before = `${location.pathname}${location.search}${location.hash}`;
    const { thread } = await openRailThread();
    fireEvent.click(within(thread).getAllByLabelText('Collapse comment')[0]!);
    fireEvent.click(within(screen.getByLabelText('Annotation thread')).getByLabelText('Collapse thread'));
    fireEvent.click(within(screen.getByLabelText('Annotation thread')).getByLabelText('Expand thread'));
    await flush();
    for (const call of fetchCalls) {
      const body = typeof call.init?.body === 'string' ? call.init.body : '';
      expect(body).not.toContain('fold');
      expect(body).not.toContain('collapse');
      expect(call.url).not.toContain('fold');
    }
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(before);
  });
});

describe('a resolved thread reads as resolved', () => {
  const railWithResolved = async () => {
    knobs.resolved = [OLD];
    layer({ railOpen: true });
    await flush(); await flush();
    return screen.getByLabelText('Resolved annotation thread');
  };

  it('the resolved card is muted, and restores itself under hover and focus', async () => {
    const card = await railWithResolved();
    expect(card.className).toContain('opacity-55');
    expect(card.className).toContain('hover:opacity-100');
    expect(card.className).toContain('focus-within:opacity-100');
    expect(screen.getByLabelText('Annotation thread').className).not.toContain('opacity-55');
  });

  it('muted is not disabled: the card still opens its conversation', async () => {
    const card = await railWithResolved();
    fireEvent.click(within(card).getByLabelText('Show resolved conversation'));
    const open = screen.getByLabelText('Resolved annotation thread');
    expect(within(open).getByLabelText('Reopen annotation')).toBeTruthy();
    expect(open.className).toContain('opacity-55');
  });
});

describe('selecting a resolved thread', () => {
  beforeEach(() => { knobs.open = [ANN]; knobs.resolved = null; });
  const serveResolved = (row: AnnotationWire) => { knobs.resolved = [row]; };

  it('highlights its passage: the same post names it open and carries its pin', async () => {
    const view = layer({ railOpen: true });
    await flush(); await flush();
    expect(view.runtime.posts().at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    const last = view.runtime.posts().at(-1);
    expect(last.openId).toBe(RESOLVED.id);
    expect(last.pins.map((p: { id: string }) => p.id)).toEqual(['ann_1', RESOLVED.id]);
    expect(last.pins.find((p: { id: string }) => p.id === RESOLVED.id)).toMatchObject({ path: RESOLVED.anchor!.path });
    // Never an open id without its pin: the document records the scroll as done and cannot repeat it.
    for (const message of view.runtime.posts()) if (message.openId) expect(message.pins.some((p: { id: string }) => p.id === message.openId)).toBe(true);
  });

  it('paints nothing resolved at rest, and stops when the thread is collapsed', async () => {
    const view = layer({ railOpen: true });
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    fireEvent.click(screen.getByLabelText('Hide resolved conversation'));
    expect(view.runtime.posts().at(-1)).toMatchObject({ openId: null, pins: [{ id: 'ann_1' }] });
    expect(view.runtime.posts().at(-1).pins).toHaveLength(1);
  });

  it('shows the original quote when the passage was removed from the document', async () => {
    serveResolved({ ...RESOLVED, anchor: null, orphaned: true, quote: 'Size: about a day.', quote_found: false });
    const view = layer({ railOpen: true });
    await flush(); await flush();
    expect(screen.queryByText('Size: about a day.')).toBeNull();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    expect(screen.getByText('Size: about a day.')).toBeTruthy();
    expect(screen.getByText(/removed from the document/i)).toBeTruthy();
    expect(view.runtime.posts().at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);
  });

  it('shows the original quote when the quoted words were edited away, and still points at the block', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure of 40%', quote_found: false });
    const view = layer({ railOpen: true });
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    expect(screen.getByText('an older figure of 40%')).toBeTruthy();
    expect(screen.getByText(/since been edited/i)).toBeTruthy();
    expect(view.runtime.posts().at(-1).pins.map((p: { id: string }) => p.id)).toContain(RESOLVED.id);
  });

  it('does not repeat a passage the document is already showing', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure', quote_found: true });
    layer({ railOpen: true });
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    expect(screen.queryByText('an older figure')).toBeNull();
  });

  it('keeps an open thread visible when resolved from elsewhere', async () => {
    const view = layer({ railOpen: true });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_PIN_MESSAGE, id: ANN.id });
    expect(view.runtime.posts().at(-1)).toMatchObject({ openId: ANN.id });
    serveResolved({ ...ANN, status: 'resolved', resolved_at: '2026-08-28T00:00:00Z' });
    view.set({ railOpen: true, liveAnnotations: [] });
    await flush(); await flush();
    expect(view.runtime.posts().at(-1)).toMatchObject({ openId: ANN.id, pins: [{ id: ANN.id, layoutOnly: true }] });
    expect(screen.getByLabelText('Reopen annotation')).toBeTruthy();
  });
});

describe('a thread resolved elsewhere counts down on its marker', () => {
  beforeEach(() => { knobs.open = [ANN]; knobs.resolved = null; });

  it('counts only visible unpaused seconds and expires without acknowledging the notification', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const view = layer({ showViewComments: true });
    await flush(); await flush();
    const position = (y: number) => view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y, width: 300, height: 40 } }] });
    position(220);
    knobs.resolved = [{ ...ANN, status: 'resolved', revision: 2, resolved_at: '2026-09-23T00:00:00Z' }];
    view.set({ showViewComments: true, liveAnnotations: [] });
    await flush(); await flush();
    const remaining = () => screen.queryByRole('status')?.textContent;
    expect(remaining()).toContain('10 seconds');
    expect(view.runtime.posts().at(-1).pins).toContainEqual(expect.objectContaining({ id: ANN.id, layoutOnly: true }));
    visibility.mockReturnValue('hidden'); vi.advanceTimersByTime(12000); expect(remaining()).toContain('10 seconds');
    visibility.mockReturnValue('visible'); position(900); vi.advanceTimersByTime(12000);
    position(220); expect(remaining()).toContain('10 seconds');
    const marker = screen.getByLabelText(/Open annotation conversation/);
    fireEvent.focusIn(marker); vi.advanceTimersByTime(12000); expect(remaining()).toContain('10 seconds');
    fireEvent.focusOut(marker); vi.advanceTimersByTime(4000); expect(remaining()).toContain('6 seconds');
    const card = marker.closest('[data-annotation-id]')!;
    expect(card.querySelector('circle')).not.toBeNull();
    expect(card.querySelector('svg')!.parentElement!.textContent).toBe('V'); // the ring shares the avatar's box
    fireEvent.mouseEnter(card); vi.advanceTimersByTime(12000); expect(remaining()).toContain('6 seconds');
    expect(card.querySelector('circle')).toBeNull(); // a paused countdown does not stretch over the preview
    fireEvent.mouseLeave(card);
    expect(card.querySelector('circle')).not.toBeNull();
    vi.advanceTimersByTime(6100);
    expect(screen.queryByLabelText(/Open annotation conversation/)).toBeNull();
    expect(fetchCalls.some((call) => call.url.includes('/api/my/people') && call.init?.method === 'PATCH')).toBe(false);
  });

  it('restarts a resolved indicator only for a new revision and cancels it on reopening', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const view = layer({ showViewComments: true });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    knobs.resolved = [{ ...ANN, status: 'resolved', revision: 2 }];
    view.set({ showViewComments: true, liveAnnotations: [] });
    await flush(); await flush();
    vi.advanceTimersByTime(4000);
    expect(screen.getByRole('status')).toHaveTextContent('6 seconds');
    view.set({ showViewComments: true, liveAnnotations: [] });
    await flush(); await flush();
    expect(screen.getByRole('status')).toHaveTextContent('6 seconds');
    knobs.resolved = [{ ...ANN, status: 'resolved', revision: 3 }];
    view.set({ showViewComments: true, liveAnnotations: [] });
    await flush(); await flush();
    expect(screen.getByRole('status')).toHaveTextContent('10 seconds');
    view.set({ showViewComments: true, liveAnnotations: [{ ...ANN, revision: 4 }] });
    await flush(); await flush();
    expect(screen.queryByRole('status')).toBeNull();
    vi.advanceTimersByTime(12000);
    expect(screen.getByLabelText(/Open annotation conversation/)).toBeVisible();
  });
});

describe('comment timestamps', () => {
  it('shows the year for older comments and exposes the full local timestamp on keyboard focus', async () => {
    const iso = '2020-09-10T14:35:27Z';
    const date = new Date(iso);
    render(() => <CommentTimestamp iso={iso} />);
    const time = screen.getByLabelText(/2020/);
    expect(time).toHaveAttribute('datetime', iso);
    expect(time.textContent).toMatch(/10 Sept? 2020/);
    expect(time.textContent).toContain(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(time).not.toHaveAttribute('title');
    fireEvent.focus(time);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(time.getAttribute('aria-label')!);
  });

  it('omits the redundant year for this year and ignores invalid dates', () => {
    const iso = new Date(new Date().getFullYear(), 5, 10, 14, 35).toISOString();
    const current = render(() => <CommentTimestamp iso={iso} />);
    expect(current.container.querySelector('time')!.textContent).toMatch(/^10 Jun · /);
    const invalid = render(() => <CommentTimestamp iso="invalid" />);
    expect(invalid.container.querySelector('time')).toBeNull();
  });
});
