/**
 * A LONG REPLY MUST NOT PUSH THE SHORT ONE OFF THE RAIL.
 *
 * The rail rendered every comment whole, so one agent answer of sixty lines
 * put the human's own two-line reply below the fold — on a phone, below the
 * sheet entirely. Three folds answer that, all rail-only and all per viewer:
 *
 *   1. AUTO-FOLD  — a body longer than ten LAID-OUT lines clamps itself, with
 *      "show more (N lines)". Measured, never counted: F5 markdown and a phone
 *      width make the same characters a different number of lines. The one
 *      exemption is the newest comment of a thread somebody just opened — that
 *      is the answer they came for.
 *   2. PER COMMENT — the author line is a toggle; collapsed it keeps the
 *      identity, the transport, the time and one line of the body.
 *   3. PER THREAD  — a chevron folds the whole conversation to its anchor
 *      snippet, one line and a reply count.
 *
 * And the memory is a fact about how somebody is reading right now: it lives
 * in `localStorage`, so it survives a remount and reaches neither the wire nor
 * the URL — a shared link must not carry someone else's folds.
 *
 * F7 rides along: a resolved card must READ as resolved when scanning, not
 * only when its check is found.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import AnnotationLayer from '../AnnotationLayer';
import { FOLD_STORAGE_KEY } from '@/lib/comment-folds';
import { STORY_ANNOTATION_PIN_MESSAGE } from '@/lib/story-runtime/contract';
import type { AnnotationWire } from '@/lib/annotations';

const NONCE = 'n'.repeat(32);

/** Forty lines of one agent answer — one paragraph, thirty-nine line breaks. */
const LONG_BODY = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the agent's answer`).join('\n');
const SHORT_REPLY = 'thanks — shipping it';

const human = (id: string, body: string, at: string) => ({
  id, body, author: { kind: 'human' as const, label: 'vivek', transport: 'browser' as const }, created_at: at,
});
const agent = (id: string, body: string, at: string) => ({
  id, body, author: { kind: 'agent' as const, label: 'Claude Code', transport: 'mcp' as const }, created_at: at,
});

const BASE: AnnotationWire = {
  id: 'ann_1',
  status: 'open',
  anchor: { key: 'a1a2b3', path: '1', spanStart: 10, spanEnd: 40 },
  orphaned: false,
  anchor_version: 2,
  snippet: 'Revenue grew 40%',
  quote: null,
  range: null,
  quote_found: null,
  thread: [],
  created_at: '2026-09-01T00:00:00Z',
  resolved_at: null,
};

/** The screenshot case: the agent answers at length, the human answers shortly. */
const LONG_THEN_SHORT: AnnotationWire = {
  ...BASE,
  thread: [
    agent('ann_1', LONG_BODY, '2026-09-01T00:00:00Z'),
    human('ann_2', SHORT_REPLY, '2026-09-01T01:00:00Z'),
  ],
};

/** The other order: the long answer IS the newest, and must not be folded. */
const SHORT_THEN_LONG: AnnotationWire = {
  ...BASE,
  thread: [
    human('ann_1', 'why is the cap 5?', '2026-09-01T00:00:00Z'),
    agent('ann_2', LONG_BODY, '2026-09-01T01:00:00Z'),
  ],
};

const RESOLVED: AnnotationWire = {
  ...BASE,
  id: 'ann_r',
  status: 'resolved',
  snippet: 'an older figure',
  thread: [human('ann_r', 'stale number here', '2026-08-01T00:00:00Z')],
  resolved_at: '2026-08-02T00:00:00Z',
};

function makeFrame() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  const frame = {
    contentWindow,
    getBoundingClientRect: () => ({ x: 0, y: 100, width: 800, height: 600, top: 100, left: 0, right: 800, bottom: 700 }),
  } as unknown as HTMLIFrameElement;
  return { frame, postMessage, contentWindow };
}

const fromFrame = (contentWindow: Window, data: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: contentWindow as unknown as MessageEventSource }));
  });

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let open: AnnotationWire = LONG_THEN_SHORT;
let resolved: AnnotationWire[] = [];

/**
 * jsdom lays nothing out, so the measurement the auto-fold rests on has to be
 * supplied: one line per rendered block and per line break, twenty pixels each.
 * Scoped to this file and restored, because a leaked prototype getter would
 * make every body in every other annotation test measure as overflowing.
 */
let scrollHeightDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  fetchCalls.length = 0;
  open = LONG_THEN_SHORT;
  resolved = [];
  localStorage.clear();
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return (this.querySelectorAll('p, pre, ul, blockquote, br').length || 1) * 20;
    },
  });
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('status=resolved')) return new Response(JSON.stringify({ annotations: resolved }), { status: 200 });
    if (u.endsWith('/annotations') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ annotations: [open] }), { status: 200 });
    }
    return new Response(JSON.stringify(open), { status: 200 });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (scrollHeightDescriptor) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeightDescriptor);
});

const flush = () => act(async () => { await Promise.resolve(); });

const layer = (frame: HTMLIFrameElement, over: Partial<Parameters<typeof AnnotationLayer>[0]> = {}) => (
  <AnnotationLayer
    id="doc1"
    frameRef={{ current: frame }}
    sessionNonce={NONCE}
    railOpen
    currentEditId="e1"
    liveAnnotations={null}
    showViewComments={false}
    topOffset={100}
    onRailOpenChange={() => {}}
    {...over}
  />
);

/** Open the rail's one thread the way a viewer does, and answer its element. */
async function openRailThread() {
  const { frame, contentWindow } = makeFrame();
  const view = render(layer(frame));
  await flush();
  fireEvent.click(await screen.findByLabelText('Open annotation thread'));
  await flush();
  return { thread: screen.getByLabelText('Annotation thread'), contentWindow, view };
}

describe('a body longer than ten lines folds itself', () => {
  it('the long agent answer clamps with "show more (N lines)" and opens on click', async () => {
    const { thread } = await openRailThread();
    // The short reply below it is rendered whole and offers nothing to unfold.
    expect(thread.textContent).toContain(SHORT_REPLY);

    const control = within(thread).getByLabelText('Show whole comment');
    expect(control.textContent).toMatch(/show more \(40 lines\)/);
    const clamped = thread.querySelector('[data-folded-body="clamped"]') as HTMLElement;
    expect(clamped).toBeTruthy();
    expect(clamped.style.maxHeight).toBe('200px');
    // Clamped, not truncated: the words are all there for find-in-page.
    expect(clamped.textContent).toContain('line 40 of the agent');

    fireEvent.click(control);
    await flush();
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeNull();
    const back = within(thread).getByLabelText('Show less of comment');
    expect(back.textContent).toMatch(/show less/);

    fireEvent.click(back);
    await flush();
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeTruthy();
  });

  it('the NEWEST comment of a thread just opened is never folded', async () => {
    open = SHORT_THEN_LONG;
    const { thread } = await openRailThread();
    expect(thread.textContent).toContain('line 40 of the agent');
    expect(thread.querySelector('[data-folded-body="clamped"]')).toBeNull();
    expect(within(thread).queryByLabelText('Show whole comment')).toBeNull();
  });
});

describe('a comment folds to its author line', () => {
  it('the author line toggles the body away, keeping identity, transport, time and one line', async () => {
    const { thread } = await openRailThread();
    const toggle = within(thread).getAllByLabelText('Collapse comment')[0];
    expect(toggle.getAttribute('role')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    await flush();
    const collapsed = within(thread).getByLabelText('Expand comment');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    // What survives the fold: who, over what, when — and the first line only.
    expect(within(collapsed).getByText('Claude Code')).toBeTruthy();
    expect(within(thread).getByLabelText('Transport MCP')).toBeTruthy();
    expect(thread.textContent).toContain("line 1 of the agent's answer");
    expect(thread.textContent).not.toContain('line 2 of the agent');
    // The human's reply below is untouched.
    expect(thread.textContent).toContain(SHORT_REPLY);

    fireEvent.click(collapsed);
    await flush();
    expect(thread.textContent).toContain('line 2 of the agent');
  });

  it('Enter and Space work the toggle from the keyboard', async () => {
    const { thread } = await openRailThread();
    fireEvent.keyDown(within(thread).getAllByLabelText('Collapse comment')[0], { key: 'Enter' });
    await flush();
    expect(thread.textContent).not.toContain('line 2 of the agent');
    fireEvent.keyDown(within(thread).getByLabelText('Expand comment'), { key: ' ' });
    await flush();
    expect(thread.textContent).toContain('line 2 of the agent');
  });

  it('the fold survives a remount — it is remembered, not held in a render', async () => {
    const { thread, view } = await openRailThread();
    fireEvent.click(within(thread).getAllByLabelText('Collapse comment')[0]);
    await flush();
    expect(JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY)!)).toEqual({
      doc1: { threads: [], comments: ['ann_1'] },
    });

    view.unmount();
    const { frame } = makeFrame();
    render(layer(frame));
    await flush();
    fireEvent.click(await screen.findByLabelText('Open annotation thread'));
    await flush();
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
    await flush();

    const folded = screen.getByLabelText('Annotation thread');
    expect(within(folded).getByLabelText('Expand thread')).toBeTruthy();
    expect(folded.textContent).toContain('Revenue grew 40%');
    expect(folded.textContent).toContain("line 1 of the agent's answer");
    expect(folded.textContent).toContain('1 reply');
    // The conversation itself is gone: no second line, no reply body, no box.
    expect(folded.textContent).not.toContain('line 2 of the agent');
    expect(folded.textContent).not.toContain(SHORT_REPLY);
    expect(within(folded).queryByLabelText('Reply to annotation')).toBeNull();
  });

  it('a pin click unfolds the thread it opens — the answer must be on screen', async () => {
    const { thread, contentWindow } = await openRailThread();
    fireEvent.click(within(thread).getByLabelText('Collapse thread'));
    await flush();
    expect(screen.getByLabelText('Annotation thread').textContent).not.toContain(SHORT_REPLY);

    await fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: 'ann_1' });
    await flush();
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
    fireEvent.click(within(thread).getAllByLabelText('Collapse comment')[0]);
    await flush();
    fireEvent.click(within(screen.getByLabelText('Annotation thread')).getByLabelText('Collapse thread'));
    await flush();
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
    pushState.mockRestore();
    replaceState.mockRestore();
  });
});

describe('F7 — a resolved thread reads as resolved', () => {
  const railWithResolved = async () => {
    resolved = [RESOLVED];
    const { frame } = makeFrame();
    render(layer(frame));
    await flush();
    return screen.getByLabelText('Resolved annotation thread');
  };

  it('the resolved card is muted, and restores itself under hover and focus', async () => {
    const card = await railWithResolved();
    expect(card.className).toContain('opacity-55');
    expect(card.className).toContain('hover:opacity-100');
    expect(card.className).toContain('focus-within:opacity-100');
    // The open thread beside it is not muted — that is the whole signal.
    expect(screen.getByLabelText('Annotation thread').className).not.toContain('opacity-55');
  });

  it('muted is not disabled: the card still opens its conversation', async () => {
    const card = await railWithResolved();
    fireEvent.click(within(card).getByLabelText('Show resolved conversation'));
    await flush();
    const open = screen.getByLabelText('Resolved annotation thread');
    expect(within(open).getByLabelText('Reopen annotation')).toBeTruthy();
    expect(open.className).toContain('opacity-55');
  });
});
