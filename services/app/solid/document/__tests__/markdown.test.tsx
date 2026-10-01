/* @jsxImportSource solid-js */
/**
 * A COMMENT BODY IS MARKDOWN TO READ AND TEXT TO SEND (components/__tests__/annotation-markdown.ui.test.tsx
 * in Solid). The rail renders it whole — a fenced block is a `<pre>` that scrolls inside the rail;
 * the compact card and a collapsed thread show the plain text; the composer's toolbar edits the
 * draft TEXT at the caret, so what ⌘↵ sends is exactly what was typed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import type { AnnotationWire } from '@/lib/annotations/store';
import { STORY_ANNOTATION_LAYOUT_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentMarkdown } from '../CommentMarkdown';
import { PersonMentionProvider } from '../PersonMention';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { ANN as BASE, fetchCalls, flush, installAnnotationFetch, knobs, layer } from './annotation-rig';

const AGENT_BODY = ['Fixed in `lib/config.ts` — the cap was **10**:', '', '```ts', 'const MAX = 10;', '```', '', '- bumped the cap', '- added a test'].join('\n');
const ANN: AnnotationWire = {
  ...BASE,
  snippet: 'the cap',
  thread: [
    { id: 'ann_1', body: 'why is the cap 5?', author: { kind: 'human', label: 'vivek', transport: 'browser', user_id: 'usr_vivek', image: null }, created_at: '2026-09-01T00:00:00Z' },
    { id: 'ann_2', body: AGENT_BODY, author: { kind: 'agent', label: 'Claude Code', transport: 'mcp', user_id: null, image: null }, created_at: '2026-09-01T01:00:00Z' },
  ],
};
const MARKDOWN_ROOT: AnnotationWire = { ...ANN, thread: [{ ...ANN.thread[1]!, id: 'ann_1' }] };
const SELECTION: StoryEditSelection = { kind: 'text', path: '1', nodeId: 'node-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] };

beforeEach(() => { installAnnotationFetch(); knobs.open = [ANN]; knobs.resolved = []; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openThread() {
  layer({ railOpen: true });
  await flush();
  fireEvent.click(await screen.findByLabelText('Open annotation thread'));
  return screen.getByLabelText('Annotation thread');
}

describe('the rail renders the comment whole', () => {
  it('a fenced block and a list come out as <pre> and <li>, not as one mono paragraph', async () => {
    const thread = await openThread();
    const pre = thread.querySelector('pre')!;
    expect(pre.textContent).toBe('const MAX = 10;');
    expect(pre.className).toContain('overflow-x-auto');
    const body = thread.querySelectorAll('[data-markdown]')[1]!;
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelectorAll('li')[0]!.textContent).toBe('bumped the cap');
    expect(thread.textContent).not.toContain('```');
    expect(thread.textContent).toContain('Fixed in');
  });

  it('inline code stays mono while the prose around it becomes the sans face', async () => {
    const thread = await openThread();
    const code = within(thread).getByText('lib/config.ts');
    expect(code.tagName).toBe('CODE');
    expect(code.className).toContain('font-mono');
    expect(code.className).toContain('break-all');
    expect(within(thread).getByText('10').tagName).toBe('STRONG');
    expect(thread.querySelector('[data-markdown]')?.className).toContain('font-sans');
  });

  it('a link opens in a new tab, and only for a scheme the parser admits', async () => {
    knobs.open = [{ ...ANN, thread: [{ ...ANN.thread[0]!, body: 'see [the docs](https://artifactbin.dev/docs) and [this](javascript:alert(1))' }] }];
    const thread = await openThread();
    const link = within(thread).getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://artifactbin.dev/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(thread.querySelector('[data-markdown]')!.querySelectorAll('a')).toHaveLength(1);
    expect(thread.textContent).toContain('[this](javascript:alert(1))');
  });

  it.each(['7d545566-1a47-4aaf-be61-cffcb7b8e8f2', 'a'.repeat(64)])('renders session %s as a badge without displaying its URL', (id) => {
    const href = `/chat?session=${id}`;
    render(() => <CommentMarkdown text={`Please ask [@Claude](${href})`} />);
    const badge = screen.getByRole('link', { name: '@Claude' });
    expect(badge.getAttribute('href')).toBe(href);
    expect(badge.hasAttribute('data-agent-mention')).toBe(true);
    expect(screen.queryByText(href)).toBeNull();
  });
});

it('marks a mentioned person who has not accepted yet, from one status read for the surface', async () => {
  const backend = { unavailable: () => null, members: vi.fn(async () => ({ people: [], mentions: { usr_asha: 'pending', usr_bo: 'accepted' } })) } as unknown as ArtifactBackend;
  render(() => <PersonMentionProvider artifactId="doc1" backend={backend}>
    <CommentMarkdown text="ask [@asha](/people/usr_asha)" /><CommentMarkdown text="and [@bo](/people/usr_bo)" />
  </PersonMentionProvider>);
  expect(await screen.findByLabelText('Invitation pending')).toHaveTextContent('· Pending');
  expect(screen.getByRole('link', { name: /@asha/ }).getAttribute('href')).toBe('/people/usr_asha');
  expect(screen.getAllByLabelText('Invitation pending')).toHaveLength(1);
  expect(backend.members).toHaveBeenCalledTimes(1);
});

describe('the compact surfaces show the plain text', () => {
  it('the floating card preview reads as a sentence, with no fence and no <pre>', async () => {
    knobs.open = [MARKDOWN_ROOT];
    const view = layer({ showViewComments: true });
    await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 220, width: 300, height: 40 } }] });
    const card = screen.getByLabelText('Open annotation comments');
    fireEvent.mouseEnter(card.querySelector('[data-annotation-id]')!);
    expect(card.querySelector('pre')).toBeNull();
    expect(card.textContent).not.toContain('```');
    expect(card.textContent).toContain('Fixed in lib/config.ts — the cap was 10:');
  });

  it('a COLLAPSED rail thread does the same — two clamped lines are no place for a fence', async () => {
    knobs.open = [MARKDOWN_ROOT];
    layer({ railOpen: true });
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
    fireEvent.input(field, { target: { value } });
    field.setSelectionRange(start, end);
    fireEvent.select(field);
    return field;
  };

  it('the toolbar wraps the selection at the caret without sending anything', async () => {
    layer({ railOpen: true, initialSelection: SELECTION });
    await flush();
    const field = await typeDraft('make it loud', 8, 12);
    fireEvent.click(within(composer()).getByLabelText('Bold'));
    await flush();
    expect(field.value).toBe('make it **loud**');
    // The WORDS stay selected, not the markers — so a second verb nests inside the first.
    fireEvent.click(within(composer()).getByLabelText('Code'));
    await flush();
    expect(field.value).toBe('make it **`loud`**');
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('every marker the toolbar names is offered, with its hint line', async () => {
    layer({ railOpen: true, initialSelection: SELECTION });
    await flush();
    for (const label of ['Bold', 'Italic', 'Code', 'Link', 'List', 'Preview comment']) expect(within(composer()).getByLabelText(label)).toBeTruthy();
    expect(within(composer()).getByText('Type @ to mention an agent · Ctrl/⌘ + Enter to send')).toBeTruthy();
  });

  it('⌘B wraps from the keyboard too', async () => {
    layer({ railOpen: true, initialSelection: SELECTION });
    await flush();
    const field = await typeDraft('make it loud', 8, 12);
    fireEvent.keyDown(field, { key: 'b', metaKey: true });
    await flush();
    expect(field.value).toBe('make it **loud**');
  });

  it('Preview swaps the textarea for the rendered draft, and back', async () => {
    layer({ railOpen: true, initialSelection: SELECTION });
    await flush();
    await typeDraft('run `npm test`\n\n- then push');
    fireEvent.click(within(composer()).getByLabelText('Preview comment'));
    expect(screen.queryByLabelText('Annotation comment')).toBeNull();
    const preview = within(composer()).getByLabelText('Comment preview');
    expect(preview.querySelector('code')?.textContent).toBe('npm test');
    expect(preview.querySelectorAll('li')).toHaveLength(1);
    fireEvent.click(within(composer()).getByLabelText('Preview comment'));
    expect((screen.getByLabelText('Annotation comment') as HTMLTextAreaElement).value).toBe('run `npm test`\n\n- then push');
  });

  it('⌘↵ still posts the RAW markdown — the wire never carries the rendering', async () => {
    layer({ railOpen: true, initialSelection: SELECTION });
    await flush();
    const field = await typeDraft('Fixed in `lib/config.ts`:\n\n```ts\nconst MAX = 10;\n```');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({ path: '1', node_id: 'node-1', body: 'Fixed in `lib/config.ts`:\n\n```ts\nconst MAX = 10;\n```' });
  });

  it('a reply box carries the same toolbar', async () => {
    const thread = await openThread();
    const reply = within(thread).getByLabelText('Reply to annotation') as HTMLTextAreaElement;
    fireEvent.input(reply, { target: { value: 'call it' } });
    reply.setSelectionRange(5, 7);
    fireEvent.click(within(thread).getByLabelText('Code'));
    await flush();
    expect(reply.value).toBe('call `it`');
  });
});
