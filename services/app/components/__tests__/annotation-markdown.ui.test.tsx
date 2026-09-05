/**
 * A COMMENT BODY IS MARKDOWN TO READ AND TEXT TO SEND.
 *
 * The wire is unchanged — the body is plain text in the column, on
 * `GET /api/artifacts/<id>` and in the MCP `annotate` tool — so everything
 * here is about the two READING surfaces and the one WRITING surface:
 *
 *   · the RAIL, which renders the whole thing: an agent's reply naming files,
 *     functions and a regex was one mono block, and a fenced block has to come
 *     out as a `<pre>` that scrolls INSIDE the rail rather than widening it.
 *   · the COMPACT card and the collapsed thread, clamped to two lines, which
 *     show the PLAIN text: two lines of "```ts" is a preview of the syntax.
 *   · the COMPOSER (and every reply box), whose toolbar edits the draft TEXT at
 *     the caret — so what ⌘↵ sends is still exactly what was typed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import AnnotationLayer from '../AnnotationLayer';
import { STORY_ANNOTATION_LAYOUT_MESSAGE } from '@/lib/story-runtime/contract';
import type { AnnotationWire } from '@/lib/annotations';

const NONCE = 'n'.repeat(32);

const AGENT_BODY = [
  'Fixed in `lib/config.ts` — the cap was **10**:',
  '',
  '```ts',
  'const MAX = 10;',
  '```',
  '',
  '- bumped the cap',
  '- added a test',
].join('\n');

const ANN: AnnotationWire = {
  id: 'ann_1',
  status: 'open',
  anchor: { key: 'a1a2b3', path: '1', spanStart: 10, spanEnd: 40 },
  orphaned: false,
  anchor_version: 2,
  snippet: 'the cap',
  quote: null,
  range: null,
  quote_found: null,
  thread: [
    { id: 'ann_1', body: 'why is the cap 5?', author: { kind: 'human', label: 'vivek', transport: 'browser' }, created_at: '2026-09-01T00:00:00Z' },
    { id: 'ann_2', body: AGENT_BODY, author: { kind: 'agent', label: 'Claude Code', transport: 'mcp' }, created_at: '2026-09-01T01:00:00Z' },
  ],
  created_at: '2026-09-01T00:00:00Z',
  resolved_at: null,
};

/** A thread whose ROOT is the markdown one — the compact card shows the root. */
const MARKDOWN_ROOT: AnnotationWire = {
  ...ANN,
  thread: [{ ...ANN.thread[1], id: 'ann_1' }],
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
let open: AnnotationWire = ANN;

beforeEach(() => {
  fetchCalls.length = 0;
  open = ANN;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('status=resolved')) return new Response(JSON.stringify({ annotations: [] }), { status: 200 });
    if (u.endsWith('/annotations') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ annotations: [open] }), { status: 200 });
    }
    return new Response(JSON.stringify(open), { status: 201 });
  }) as unknown as typeof fetch);
});

afterEach(() => vi.unstubAllGlobals());

const flush = () => act(async () => { await Promise.resolve(); });

const layer = (frame: HTMLIFrameElement, over: Partial<Parameters<typeof AnnotationLayer>[0]> = {}) => (
  <AnnotationLayer
    id="doc1"
    frameRef={{ current: frame }}
    sessionNonce={NONCE}
    railOpen={false}
    liveAnnotations={null}
    showViewComments={false}
    topOffset={100}
    onRailOpenChange={() => {}}
    {...over}
  />
);

const SELECTION = {
  kind: 'text' as const, path: '1', nodeId: 'node-1', tag: 'p',
  rect: { x: 5, y: 6, width: 200, height: 40 },
  className: '', style: '', ancestors: [],
};

/** Open the one rail thread and answer with its element, scoped for queries. */
async function openThread() {
  const { frame } = makeFrame();
  render(layer(frame, { railOpen: true }));
  await flush();
  fireEvent.click(await screen.findByLabelText('Open annotation thread'));
  await flush();
  return screen.getByLabelText('Annotation thread');
}

describe('the rail renders the comment whole', () => {
  it('a fenced block and a list come out as <pre> and <li>, not as one mono paragraph', async () => {
    const thread = await openThread();
    const pre = thread.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toBe('const MAX = 10;');
    // …and it scrolls INSIDE the rail rather than widening it.
    expect(pre!.className).toContain('overflow-x-auto');
    // Scoped to the rendered body: the thread's own comment list is <li>s too.
    const body = thread.querySelectorAll('[data-markdown]')[1];
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelectorAll('li')[0].textContent).toBe('bumped the cap');
    // The fence and the bullets themselves are gone; the words are not.
    expect(thread.textContent).not.toContain('```');
    expect(thread.textContent).toContain('Fixed in');
  });

  it('inline code stays mono while the prose around it becomes the sans face', async () => {
    const thread = await openThread();
    const code = within(thread).getByText('lib/config.ts');
    expect(code.tagName).toBe('CODE');
    expect(code.className).toContain('font-mono');
    // A long identifier has no box to scroll in — it must WRAP, or it is cut
    // off at the rail's edge with no affordance at all.
    expect(code.className).toContain('break-all');
    expect(within(thread).getByText('10').tagName).toBe('STRONG');
    const prose = thread.querySelector('[data-markdown]');
    expect(prose?.className).toContain('font-sans');
  });

  it('a link opens in a new tab, and only for a scheme the parser admits', async () => {
    open = {
      ...ANN,
      thread: [{ ...ANN.thread[0], body: 'see [the docs](https://artifactbin.dev/docs) and [this](javascript:alert(1))' }],
    };
    const thread = await openThread();
    const link = within(thread).getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://artifactbin.dev/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // Scoped to the body: the author's own profile link is a link too.
    expect(thread.querySelector('[data-markdown]')!.querySelectorAll('a')).toHaveLength(1);
    expect(thread.textContent).toContain('[this](javascript:alert(1))');
  });
});

describe('the compact surfaces show the plain text', () => {
  it('the floating card preview reads as a sentence, with no fence and no <pre>', async () => {
    open = MARKDOWN_ROOT;
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, { showViewComments: true }));
    await flush();
    await fromFrame(contentWindow, {
      type: STORY_ANNOTATION_LAYOUT_MESSAGE, nonce: NONCE,
      positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }],
    });
    const card = screen.getByLabelText('Open annotation comments');
    fireEvent.mouseEnter(card.querySelector('[data-annotation-id]')!);
    await flush();
    expect(card.querySelector('pre')).toBeNull();
    expect(card.textContent).not.toContain('```');
    expect(card.textContent).toContain('Fixed in lib/config.ts — the cap was 10:');
  });

  it('a COLLAPSED rail thread does the same — two clamped lines are no place for a fence', async () => {
    open = MARKDOWN_ROOT;
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush();
    const thread = screen.getByLabelText('Annotation thread');
    expect(thread.querySelector('pre')).toBeNull();
    expect(thread.textContent).not.toContain('```');
    expect(thread.textContent).toContain('Fixed in lib/config.ts');
  });
});

describe('the composer writes markdown, and sends TEXT', () => {
  const composer = () => screen.getByRole('dialog', { name: 'Annotation composer' });

  const typeDraft = async (value: string, start = value.length, end = value.length) => {
    const field = screen.getByLabelText('Annotation comment') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value } });
    await flush();
    field.setSelectionRange(start, end);
    fireEvent.select(field);
    return field;
  };

  it('the toolbar wraps the selection at the caret without sending anything', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, initialSelection: SELECTION }));
    await flush();
    const field = await typeDraft('make it loud', 8, 12);
    fireEvent.click(within(composer()).getByLabelText('Bold'));
    await flush();
    expect(field.value).toBe('make it **loud**');

    // The WORDS stay selected, not the markers — so a second verb nests
    // inside the first, the way every editor's bold-then-code behaves.
    fireEvent.click(within(composer()).getByLabelText('Code'));
    await flush();
    expect(field.value).toBe('make it **`loud`**');
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('every marker the toolbar names is offered', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, initialSelection: SELECTION }));
    await flush();
    for (const label of ['Bold', 'Italic', 'Code', 'Link', 'List', 'Preview comment']) {
      expect(within(composer()).getByLabelText(label)).toBeTruthy();
    }
  });

  it('⌘B wraps from the keyboard too', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, initialSelection: SELECTION }));
    await flush();
    const field = await typeDraft('make it loud', 8, 12);
    fireEvent.keyDown(field, { key: 'b', metaKey: true });
    await flush();
    expect(field.value).toBe('make it **loud**');
  });

  it('Preview swaps the textarea for the rendered draft, and back', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, initialSelection: SELECTION }));
    await flush();
    await typeDraft('run `npm test`\n\n- then push');
    fireEvent.click(within(composer()).getByLabelText('Preview comment'));
    await flush();
    expect(screen.queryByLabelText('Annotation comment')).toBeNull();
    const preview = within(composer()).getByLabelText('Comment preview');
    expect(preview.querySelector('code')?.textContent).toBe('npm test');
    expect(preview.querySelectorAll('li')).toHaveLength(1);

    fireEvent.click(within(composer()).getByLabelText('Preview comment'));
    await flush();
    expect((screen.getByLabelText('Annotation comment') as HTMLTextAreaElement).value).toBe('run `npm test`\n\n- then push');
  });

  it('⌘↵ still posts the RAW markdown — the wire never carries the rendering', async () => {
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true, initialSelection: SELECTION }));
    await flush();
    const field = await typeDraft('Fixed in `lib/config.ts`:\n\n```ts\nconst MAX = 10;\n```');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({
      path: '1', node_id: 'node-1', body: 'Fixed in `lib/config.ts`:\n\n```ts\nconst MAX = 10;\n```',
    });
  });

  it('a reply box carries the same toolbar', async () => {
    const thread = await openThread();
    const reply = within(thread).getByLabelText('Reply to annotation') as HTMLTextAreaElement;
    fireEvent.change(reply, { target: { value: 'call it' } });
    await flush();
    reply.setSelectionRange(5, 7);
    fireEvent.click(within(thread).getByLabelText('Code'));
    await flush();
    expect(reply.value).toBe('call `it`');
  });
});
