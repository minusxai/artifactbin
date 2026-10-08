import { replaceComment } from './comment-input';
/* @jsxImportSource solid-js */
/**
 * @MENTIONS in a comment draft: people
 * and agents, a stable session id in the wire text and only the name in the field, the keyboard
 * owned by the picker while it is open, and a link to manage agents.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { createSignal } from 'solid-js';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentMarkdownField } from '../CommentMarkdownField';
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

it.each([[], [{id:'agent',name:'review',harness:'codex',online:true}]].map(agents => ({agents})))('offers agent management when no agents match: %j', async ({agents}) => {
  vi.stubGlobal('fetch', sessions(agents));
  const select = vi.fn();
  const submit = vi.fn((event: Event) => event.preventDefault());
  render(() => <form onSubmit={submit}><CommentMentionPicker backend={http()} query="missing" onSelect={select} /></form>);
  const manage = await screen.findByRole('link', { name: 'Manage agents' });
  expect(manage).toHaveAttribute('href', '/chat');
  expect(manage).toHaveAttribute('target', '_blank');
  expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('No matching agents.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy connection request' })).toBeNull();
  expect(screen.queryByText('Ask your agent to connect:')).toBeNull();
  expect(select).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it.each([true, false])('offers management alongside an existing agent (online=%s)', async (online) => {
  vi.stubGlobal('fetch', sessions([{ id: 'agent', name: 'review', harness: 'codex', managed: true, exitCode: null, online }]));
  render(() => <CommentMentionPicker backend={http()} query="" onSelect={vi.fn()} />);
  await screen.findByLabelText('Mention review (codex)');
  expect(screen.getByRole('link', { name: 'Manage agents' })).toHaveAttribute('href', '/chat');
  expect(screen.queryByRole('button', { name: 'Copy connection request' })).toBeNull();
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
  expect(screen.getByRole('link', { name: 'Manage agents' })).toHaveAttribute('href', '/chat');
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
  expect(screen.getByLabelText('Draft')).toHaveAttribute('aria-placeholder', 'Write a comment ...');
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

it('quick choices and typed mentions insert identical badges and keep the caret after them', async () => {
  const id='b'.repeat(64);
  vi.stubGlobal('fetch', sessions([{id,name:'koala-8e44ad',harness:'claude',online:true}]));
  const submit=vi.fn();
  render(()=>{const [value,change]=createSignal('');return <CommentMarkdownField label="Draft" backend={http()} quickAgents value={value()} onChange={change} onSubmit={()=>submit(value())}/>;});
  const field=screen.getByLabelText('Draft');
  fireEvent.click(await screen.findByRole('button',{name:'Tag koala-8e44ad'}));
  const quick=field.querySelector('[data-comment-mention]')?.outerHTML;
  expect(quick).toBeTruthy();
  fireEvent.keyDown(field,{key:'Enter',ctrlKey:true});
  expect(submit).toHaveBeenLastCalledWith(`[@koala-8e44ad](/chat?session=${id}) `);
  replaceComment(field,'@ko');
  fireEvent.click(await screen.findByLabelText('Mention koala-8e44ad (claude)'));
  expect(field.querySelector('[data-comment-mention]')?.outerHTML).toBe(quick);
  fireEvent.keyDown(field,{key:'Enter',ctrlKey:true});
  expect(submit).toHaveBeenLastCalledWith(`[@koala-8e44ad](/chat?session=${id}) `);
});

it('hides tagged quick choices and restores them when their badge is removed', async () => {
  const id='c'.repeat(64);
  vi.stubGlobal('fetch', sessions([{id,name:'review',harness:'claude',online:true}]));
  render(()=>{const [value,change]=createSignal('');return <CommentMarkdownField label="Draft" backend={http()} quickAgents value={value()} onChange={change}/>;});
  const field=screen.getByLabelText('Draft');
  fireEvent.click(await screen.findByRole('button',{name:'Tag review'}));
  expect(screen.queryByRole('button',{name:'Tag review'})).toBeNull();
  expect(screen.getByRole('link',{name:'Manage agents'})).toHaveAttribute('href', '/chat');
  expect(screen.getByText('All agents tagged')).toBeTruthy();
  replaceComment(field,'Just a comment');
  expect(screen.getByRole('button',{name:'Tag review'})).toBeTruthy();
  replaceComment(field,'`[@review](/chat?session='+id+')`');
  expect(screen.getByRole('button',{name:'Tag review'})).toBeTruthy();
  replaceComment(field,'[@review](/chat?session='+id+') ');
  expect(screen.queryByRole('button',{name:'Tag review'})).toBeNull();
});
