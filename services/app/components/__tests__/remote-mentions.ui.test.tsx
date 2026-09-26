import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import RemoteMentionPicker from "../RemoteMentionPicker";
import MarkdownLite from '../MarkdownLite';
import MarkdownField from '../MarkdownField';
import { useState } from 'react';
import { fakeBackend, httpBackendWrapper } from '@/test/helpers/artifact-backend';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
afterEach(() => vi.unstubAllGlobals());
it("lets the user select an online session with a stable mention ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          {
            id: "123",
            name: "Backend",
            harness: "claude",
            machine: "laptop",
            online: true,
          },
          { id: "456", name: "Old", harness: "codex", online: false },
        ],
      }),
    }),
  );
  const select = vi.fn();
  render(<RemoteMentionPicker query="back" onSelect={select} />, { wrapper: httpBackendWrapper('doc1') });
  await waitFor(() =>
    expect(screen.getByLabelText("Mention Backend (claude)")).toBeTruthy(),
  );
  fireEvent.click(screen.getByLabelText("Mention Backend (claude)"));
  expect(select).toHaveBeenCalledWith("[@Backend](/chat?session=123) ");
  expect(screen.queryByLabelText("Mention Old (codex)")).toBeNull();
});

it.each(['7d545566-1a47-4aaf-be61-cffcb7b8e8f2', 'a'.repeat(64)])('renders session %s as a badge without displaying its URL', (id) => {
  const href = `/chat?session=${id}`;
  render(<MarkdownLite text={`Please ask [@Claude](${href})`} />);
  const badge = screen.getByRole('link', { name: '@Claude' });
  expect(badge.getAttribute('href')).toBe(href);
  expect(badge.hasAttribute('data-agent-mention')).toBe(true);
  expect(screen.queryByText(href)).toBeNull();
});

it.each(['7d545566-1a47-4aaf-be61-cffcb7b8e8f2', 'b'.repeat(64)])('selects session %s with the keyboard without submitting and Escape dismisses only the picker', async (id) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [
    { id, name: 'Claude', harness: 'claude', online: true, machine: 'laptop' },
  ] }) }));
  const submit = vi.fn();
  const escape = vi.fn();
  function Composer() {
    const [value, change] = useState('');
    const [previewing, preview] = useState(false);
    return <div onKeyDown={escape}><MarkdownField label="Draft" previewLabel="Draft preview" previewToggleLabel="Toggle preview"
      value={value} onChange={change} previewing={previewing} onPreviewingChange={preview} onSubmit={() => submit(value)} /></div>;
  }
  render(<Composer />, { wrapper: httpBackendWrapper('doc1') });
  const field = screen.getByLabelText('Draft');
  fireEvent.change(field, { target: { value: '@cl', selectionStart: 3 } });
  await screen.findByLabelText('Mention Claude (claude)');
  fireEvent.keyDown(field, { key: 'Enter' });
  expect((field as HTMLTextAreaElement).value).toBe('@Claude ');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
  expect(submit).toHaveBeenCalledWith(`[@Claude](/chat?session=${id}) `);
  fireEvent.change(field, { target: { value: '@', selectionStart: 1 } });
  await screen.findByLabelText('Mention Claude (claude)');
  escape.mockClear();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByLabelText('Agent sessions')).toBeNull();
  expect(escape).not.toHaveBeenCalled();
});

it('offers a copyable connection request without selecting a mention or submitting the comment', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const select = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={submit}><RemoteMentionPicker query="" onSelect={select} /></form>, { wrapper: httpBackendWrapper('doc1') });
  expect(screen.queryByRole('button', { name: 'Copy connection request' })).toBeNull();
  const copy = await screen.findByRole('button', { name: 'Copy connection request' });
  expect(screen.getByText('Ask your agent to connect:')).toBeTruthy();
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Connect to afbin remote so I can @mention you in artifact comments.'));
  expect(await screen.findByRole('status')).toHaveTextContent('Copied');
  expect(select).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the connection request available when clipboard access fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) }));
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  render(<RemoteMentionPicker query="" onSelect={vi.fn()} />, { wrapper: httpBackendWrapper('doc1') });
  fireEvent.click(await screen.findByRole('button', { name: 'Copy connection request' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Could not copy. Select and copy the request above.');
  expect(screen.getByText('Connect to afbin remote so I can @mention you in artifact comments.')).toBeTruthy();
});

it.each([true, false])('offers setup alongside an existing agent (online=%s)', async (online) => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({sessions:[{id:'agent',name:'review',harness:'codex',managed:true,exitCode:null,online}]})}));
 render(<RemoteMentionPicker query="" onSelect={vi.fn()} />, { wrapper: httpBackendWrapper('doc1') });
 await screen.findByLabelText('Mention review (codex)');
 fireEvent.click(screen.getByRole('button',{name:'Add another agent'}));
 expect(screen.getByRole('button',{name:'Copy connection request'})).toBeTruthy();
});
it('removes an offline agent without selecting it and keeps failures retryable', async () => {
 let fail=true;
 const fetch=vi.fn(async (_url:string,options?:RequestInit)=> options?.method==='DELETE'
  ? {ok:!fail,json:async()=>({error:'Try again'})}
  : {ok:true,json:async()=>({sessions:[{id:'agent',name:'review',harness:'codex',managed:true,exitCode:null,online:false}]})});
 vi.stubGlobal('fetch',fetch);const select=vi.fn();
 render(<RemoteMentionPicker query="" onSelect={select} />, { wrapper: httpBackendWrapper('doc1') });
 fireEvent.click(await screen.findByRole('button',{name:'Remove review'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
 expect(screen.getByLabelText('Mention review (codex)')).toBeTruthy();
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Remove review'}));
 await waitFor(()=>expect(screen.queryByLabelText('Mention review (codex)')).toBeNull());
 expect(select).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Copy connection request'})).toBeTruthy();
});

it('treats @ as a plain character where no one can be mentioned (an offline file)', () => {
  function Composer() {
    const [value, change] = useState('');
    const [previewing, preview] = useState(false);
    return <MarkdownField label="Draft" previewLabel="Draft preview" previewToggleLabel="Toggle preview"
      value={value} onChange={change} previewing={previewing} onPreviewingChange={preview} onSubmit={() => {}} />;
  }
  const offline = fakeBackend({ mentions: 'Mentions need a connection.', remoteSessions: 'Agents need a connection.' });
  render(<ArtifactBackendProvider backend={offline}><Composer /></ArtifactBackendProvider>);
  expect(screen.queryByText(/Type @ to mention/)).toBeNull();
  expect(screen.getByText(/Ctrl\/⌘ \+ Enter to send/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'thanks @Asha', selectionStart: 12 } });
  expect(screen.queryByLabelText('Agent sessions')).toBeNull();
  expect(offline.remoteSessions).not.toHaveBeenCalled();
});
