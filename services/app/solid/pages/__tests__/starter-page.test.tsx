/* @jsxImportSource solid-js */
/**
 * THE STARTER (solid/pages/Starter): a document still holding the start placeholder is not compiled
 * (lib/artifact-page), so its page is app UI — the document page's bar and the agent instructions.
 * It reloads into the compiled reader the moment the first
 * real version arrives, reports its view once, and opens the editor on the compiled placeholder at
 * `/edit` (`#edit` included), as it does for any starter.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { START_PLACEHOLDER_MARKUP } from '@/lib/serving/start-placeholder';
import { existingPaste } from '@/lib/serving/agent-copy';
import { reloadKeepingPlace } from '@/lib/islands/live-update';
import { replaceDocument } from '@/solid/lib/document-navigation';
import { StarterPage, type StarterAnswer } from '@/solid/pages/Starter';

vi.mock('@/lib/islands/live-update', () => ({ reloadKeepingPlace: vi.fn() }));
vi.mock('@/solid/lib/document-navigation', () => ({ replaceDocument: vi.fn() }));

const streams: Array<{ url: string; onmessage: ((event: { data: string }) => void) | null }> = [];
class FakeEventSource {
  url: string; onmessage: ((event: { data: string }) => void) | null = null;
  constructor(url: string) { this.url = url; streams.push(this); }
  addEventListener() {} removeEventListener() {} close() {}
}
let frameSource = START_PLACEHOLDER_MARKUP;
beforeEach(() => {
  streams.length = 0; frameSource = START_PLACEHOLDER_MARKUP;
  vi.mocked(reloadKeepingPlace).mockClear(); vi.mocked(replaceDocument).mockClear();
  document.body.removeAttribute('data-mx-view-reported');
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/events/frame')) return Response.json({ editId: 'e2', version: 2, by: null, format: 'markup', title: null, source: frameSource, dataPreview: null });
    if (url.includes('/members')) return Response.json({ members: [], pending: [], self: null, canManage: false, canInvite: false });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });

const answer = (role: StarterAnswer['role'] = 'owner'): StarterAnswer => ({
  role, kind: role === 'viewer' ? 'none' : 'anon', like: { liked: false, count: 0 }, follow: null,
  surface: { id: 'sta001', editId: 'e1', format: 'markup', title: null, heading: 'Untitled', visibility: 'public', version: 1, starter: true, author: { username: null }, openAnnotations: 0, theme: null, colorMode: null },
});
const open = (data = answer(), path = '/a/sta001') => {
  window.history.replaceState(null, '', path);
  return render(() => <Router><Route path="/a/:id" component={() => <StarterPage answer={data} />} /></Router>);
};

it('hands its reader the agent instructions for this document, editable and copyable', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  open();
  expect(screen.getByRole('heading', { name: 'Your artifact is ready for your agent!' })).toBeInTheDocument();
  const instructions = screen.getByRole('textbox', { name: 'Agent instructions' }) as HTMLTextAreaElement;
  expect(instructions.value).toBe(existingPaste(window.location.origin, 'sta001'));
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for your agent…');
  fireEvent.input(instructions, { target: { value: 'Build a dashboard' } });
  fireEvent.click(screen.getByRole('button', { name: 'Copy agent instructions' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Build a dashboard'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy agent instructions' })).toHaveTextContent('Copied — paste into your agent'));
});

it('says how to copy by hand when the clipboard refuses', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
  open(answer('viewer'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy agent instructions' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select and copy the instructions above.'));
});

it('wears the document page\'s bar and its artifact controls, with editing only for writers', () => {
  open();
  expect(screen.getByRole('banner', { name: 'Page bar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(screen.getByRole('region', { name: 'Artifact controls' }));
  expect(panel.getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  cleanup(); document.body.replaceChildren();
  open(answer('viewer'));
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(within(screen.getByRole('region', { name: 'Artifact controls' })).queryByRole('button', { name: 'Edit artifact' })).toBeNull();
});

it('opens the editor on the compiled placeholder: #edit and Edit both cross to /edit', () => {
  open(answer(), '/a/sta001#edit');
  expect(replaceDocument).toHaveBeenCalledWith('/a/sta001/edit');
  cleanup(); document.body.replaceChildren(); vi.mocked(replaceDocument).mockClear();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(replaceDocument).toHaveBeenCalledWith('/a/sta001/edit');
  cleanup(); document.body.replaceChildren(); vi.mocked(replaceDocument).mockClear();
  open(answer('viewer'), '/a/sta001#edit');
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('reloads into the compiled reader when the first real version arrives, not before', async () => {
  open();
  await waitFor(() => expect(streams.some((stream) => stream.url === '/a/sta001/events')).toBe(true));
  const stream = streams.find((candidate) => candidate.url === '/a/sta001/events')!;
  frameSource = '<h1>Landed by the agent</h1>';
  stream.onmessage?.({ data: JSON.stringify({ editId: 'e2', version: 2, by: null }) });
  await waitFor(() => expect(reloadKeepingPlace).toHaveBeenCalledTimes(1));
});

it('reports the open once', async () => {
  open();
  await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => url === '/api/page/artifact/sta001/view' && init?.method === 'POST')).toHaveLength(1));
});


it('offers a blank report transition only to writers', () => {
  open();
  expect(screen.getByRole('button', { name: 'Continue with blank report' })).toBeInTheDocument();
  cleanup(); document.body.replaceChildren();
  open(answer('viewer'));
  expect(screen.queryByRole('button', { name: 'Continue with blank report' })).toBeNull();
});
