import { replaceComment } from './comment-input';
/* @jsxImportSource solid-js */
/**
 * @MENTIONS in a comment draft: people
 * and agents, a stable session id in the wire text and only the name in the field, the keyboard
 * owned by the picker while it is open, and a copyable connection request when no agent is there.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { createSignal } from 'solid-js';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentMarkdownField } from '../CommentMarkdown';
import { CommentMentionPicker } from '../CommentMentionPicker';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const http = () => createHttpBackend('doc1');
const sessions = (list: unknown[]) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: list }) });

it('lets the user select an online session with a stable mention ID', async () => {
  vi.stubGlobal('fetch', sessions([{ id: '123', name: 'Backend', harness: 'claude', machine: 'laptop', online: true }, { id: '456', name: 'Old', harness: 'codex', online: false }]));
  const select = vi.fn();
  render(() => <CommentMentionPicker backend={http()} query="back" onSelect={select} />);
  await waitFor(() => expect(screen.getByLabelText('Mention Backend (claude)')).toBeTruthy());
  expect(screen.getByLabelText('Mention Backend (claude)').textContent).toContain('Claude Code · laptop');
  fireEvent.click(screen.getByLabelText('Mention Backend (claude)'));
  expect(select).toHaveBeenCalledWith('[@Backend](/chat?session=123) ');
  expect(screen.queryByLabelText('Mention Old (codex)')).toBeNull();
});

it.each(['7d545566-1a47-4aaf-be61-cffcb7b8e8f2', 'b'.repeat(64)])('selects session %s with the keyboard without submitting and Escape dismisses only the picker', async (id) => {
  vi.stubGlobal('fetch', sessions([{ id, name: 'Claude', harness: 'claude', online: true, machine: 'laptop' }]));
  const submit = vi.fn();
  const escape = vi.fn();
  const backend = http();
  render(() => {
    const [value, change] = createSignal('');
    return <div onKeyDown={escape}><CommentMarkdownField label="Draft" backend={backend}
      value={value()} onChange={change} onSubmit={() => submit(value())} /></div>;
  });
  const field = screen.getByLabelText('Draft') as HTMLElement;
  replaceComment(field, '@cl');
  await screen.findByLabelText('Mention Claude (claude)');
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(field.textContent).toBe('@Claude ');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
  expect(submit).toHaveBeenCalledWith(`[@Claude](/chat?session=${id}) `);
  replaceComment(field, '@');
  await screen.findByLabelText('Mention Claude (claude)');
  escape.mockClear();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByLabelText('Agent sessions')).toBeNull();
  expect(escape).not.toHaveBeenCalled();
});

it('offers a copyable connection request without selecting a mention or submitting the comment', async () => {
  vi.stubGlobal('fetch', sessions([]));
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const select = vi.fn();
  const submit = vi.fn((event: Event) => event.preventDefault());
  render(() => <form onSubmit={submit}><CommentMentionPicker backend={http()} query="" onSelect={select} /></form>);
  expect(screen.queryByRole('button', { name: 'Copy connection request' })).toBeNull();
  const copy = await screen.findByRole('button', { name: 'Copy connection request' });
  expect(screen.getByText('Ask your agent to connect:')).toBeTruthy();
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Connect to afbin remote so I can @mention you in artifact comments.'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
  expect(select).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the connection request available when clipboard access fails', async () => {
  vi.stubGlobal('fetch', sessions([]));
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  render(() => <CommentMentionPicker backend={http()} query="" onSelect={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copy connection request' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select and copy the request above.'));
  expect(screen.getByText('Connect to afbin remote so I can @mention you in artifact comments.')).toBeTruthy();
});

it.each([true, false])('offers setup alongside an existing agent (online=%s)', async (online) => {
  vi.stubGlobal('fetch', sessions([{ id: 'agent', name: 'review', harness: 'codex', managed: true, exitCode: null, online }]));
  render(() => <CommentMentionPicker backend={http()} query="" onSelect={vi.fn()} />);
  await screen.findByLabelText('Mention review (codex)');
  fireEvent.click(screen.getByRole('button', { name: 'Add another agent' }));
  expect(screen.getByRole('button', { name: 'Copy connection request' })).toBeTruthy();
});

it('removes an offline agent without selecting it and keeps failures retryable', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'DELETE'
    ? { ok: !fail, json: async () => ({ error: 'Try again' }) }
    : { ok: true, json: async () => ({ sessions: [{ id: 'agent', name: 'review', harness: 'codex', managed: true, exitCode: null, online: false }] }) }));
  const select = vi.fn();
  render(() => <CommentMentionPicker backend={http()} query="" onSelect={select} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove review' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  expect(screen.getByLabelText('Mention review (codex)')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Remove review' }));
  await waitFor(() => expect(screen.queryByLabelText('Mention review (codex)')).toBeNull());
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Copy connection request' })).toBeTruthy();
});

it('mentions a person by their stable account id', async () => {
  const backend = {
    unavailable: () => null,
    remoteSessions: vi.fn(async () => ({ sessions: [] })),
    members: vi.fn(async () => ({ people: [{ user_id: 'usr_asha', username: 'asha', name: 'Asha' }], mentions: {} })),
  } as unknown as ArtifactBackend;
  const select = vi.fn();
  render(() => <CommentMentionPicker backend={backend} artifactId="doc1" query="as" onSelect={select} />);
  fireEvent.click(await screen.findByLabelText('Mention @asha'));
  expect(select).toHaveBeenCalledWith('[@asha](/people/usr_asha)');
  expect(backend.members).toHaveBeenCalledWith('as', expect.anything());
});

it('treats @ as a plain character where no one can be mentioned (an offline file)', () => {
  const offline = {
    mode: 'offline',
    unavailable: (feature: string) => ({ mentions: 'Mentions need a connection.', remoteSessions: 'Agents need a connection.' } as Record<string, string>)[feature] ?? null,
    remoteSessions: vi.fn(async () => ({ sessions: [] })),
    members: vi.fn(async () => null),
  } as unknown as ArtifactBackend;
  render(() => {
    const [value, change] = createSignal('');
    return <CommentMarkdownField label="Draft" backend={offline} value={value()} onChange={change} onSubmit={() => {}} />;
  });
  expect(screen.queryByText(/Type @ to mention/)).toBeNull();
  expect(screen.queryByText(/Ctrl\/⌘ \+ Enter to send/)).toBeNull();
  replaceComment(screen.getByLabelText('Draft'), 'thanks @Asha');
  expect(screen.queryByLabelText('Agent sessions')).toBeNull();
  expect(offline.remoteSessions).not.toHaveBeenCalled();
});

it('excludes native boxes without a comment relay while retaining the hosted default agent',async()=>{
 vi.stubGlobal('fetch',sessions([{id:'native',runId:'run-one',name:'Native',harness:'codex',online:true,managed:true,exitCode:null,activity:'working'},{id:'default',name:'Default',harness:'pi',online:true,managed:true,exitCode:null,activity:'listening'}]));
 render(()=><CommentMentionPicker backend={http()} query="" onSelect={()=>{}} />);
 await screen.findByLabelText('Mention Default (pi)');
 expect(screen.queryByLabelText('Mention Native (codex)')).toBeNull();
});
