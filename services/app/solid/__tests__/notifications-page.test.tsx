/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { stubFetch } from '@/test/helpers/fetch-stub';

const SESSION = { user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
it.each([false, true])('marks all notifications read from the inbox (compact: %s)', async compact => {
  let read = false;
  let finish: (() => void) | undefined;
  const writes: unknown[] = [];
  stubFetch({
    '/api/my/people': async (_url, init) => {
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)));
        await new Promise<void>(resolve => { finish = resolve; });
        read = true;
      }
      return Response.json({ autoAccept: false, unread: read ? 0 : 70, next: null, blocks: [], notifications: [{ id: 'n1', artifact_id: 'doc1', user_id: 'usr_1', sender_id: 'usr_2', username: 'alice', name: 'Alex Example', kind: 'reply', title: 'Notes', read_at: read ? new Date().toISOString() : null, revision: 1 }] });
    },
  }, { session: SESSION });
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const bell = await screen.findByRole('button', { name: 'Notifications, unread updates' });
  if (compact) fireEvent.click(bell);
  const view = compact ? within(await screen.findByRole('region', { name: 'Notifications' })) : screen;
  const button = await view.findByRole('button', { name: 'Mark all as read' });
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled());
  expect(writes).toEqual([{ readAll: true }]);
  finish!();
  await waitFor(() => expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument());
  expect(view.getByRole('link', { name: 'Alex Example replied in Notes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
});
it('keeps unread notifications and allows another attempt when marking all fails', async () => {
  stubFetch({
    '/api/my/people': (_url, init) => {
      if (init?.method === 'PATCH') return Response.json({}, { status: 500 });
      return Response.json({ autoAccept: false, unread: 1, next: null, blocks: [], notifications: [{ id: 'n1', artifact_id: 'doc1', sender_id: 'usr_2', username: 'alice', name: 'Alex Example', kind: 'reply', title: 'Notes', read_at: null, revision: 1 }] });
    },
  }, { session: SESSION });
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const button = await screen.findByRole('button', { name: 'Mark all as read' });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notifications');
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getByLabelText('Unread')).toBeInTheDocument();
});

it('opens the bell and shows an invitation with a working approval action', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  stubFetch({
    '/api/my/people': { autoAccept: false, unread: 1, next: null, blocks: [], notifications: [{ id: 'n1', artifact_id: 'doc1', user_id: 'usr_1', status: 'pending', direction: 'request', sender_id: 'usr_2', username: 'alice', kind: 'request', source: null, title: 'Notes', read_at: null, revision: 1 }] },
    '/api/my/artifacts/doc1/members': {},
  }, { session: SESSION, onCall: (url, init) => { calls.push({ url: String(url), method: init?.method ?? 'GET' }); } });
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const bell = await screen.findByRole('button', { name: 'Notifications, unread updates' });
  fireEvent.click(bell);
  const panel = within(await screen.findByRole('region', { name: 'Notifications' }));
  expect(panel.getByRole('region', { name: 'Notification list' })).toHaveTextContent('alice');
  fireEvent.click(panel.getByRole('button', { name: 'Approve request' }));
  await waitFor(() => expect(calls).toContainEqual({ url: '/api/my/artifacts/doc1/members', method: 'POST' }));
});

it('labels an agent reply without showing an unrelated accepted invitation status', async () => {
 stubFetch({
  '/api/my/people':{autoAccept:false,unread:1,next:null,blocks:[],notifications:[
   {id:'reply',artifact_id:'doc1',user_id:'usr_1',status:'accepted',direction:'owner',sender_id:'usr_1',username:'owner',agent_label:'afbin',kind:'reply',source:'comment:thread',title:'Notes',read_at:null,revision:1},
   {id:'invite',artifact_id:'doc2',user_id:'usr_1',status:'accepted',direction:'invitation',sender_id:'usr_2',username:'alice',kind:'invitation',source:null,title:'Shared',read_at:null,revision:1}
  ]},
 },{session:{user:{id:'usr_1',email:'a@example.com',username:'owner',image:null},kind:'account',onboarded:true}});
 window.history.replaceState(null,'','/notifications');render(()=><App/>);
 const link=await screen.findByRole('link',{name:'@afbin replied in Notes'});
 expect(link.closest('li')).not.toHaveTextContent('Invitation accepted');
 expect(screen.getByRole('link',{name:'/@alice invited you to Shared'}).closest('li')).toHaveTextContent('Invitation accepted');
});

const INBOX = { autoAccept: false, unread: 1, next: null, blocks: [], notifications: [{ id: 'n1', artifact_id: 'doc1', user_id: 'usr_1', sender_id: 'usr_2', username: 'alice', name: 'Alex Example', kind: 'reply', source: null, title: 'Notes', read_at: null, revision: 1 }] };

it('retries a failed load visibly, keeps a failed retry dated and clears the error once a retry succeeds', async () => {
  let clock = Date.parse('2026-10-10T10:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 60_000));
  const outcomes: Array<'fail' | 'hold'> = ['fail', 'fail', 'hold'];
  let release: (() => void) | undefined;
  stubFetch({
    '/api/my/people': async () => {
      const outcome = outcomes.shift();
      if (outcome === 'fail') return Response.json({ error: 'timeout' }, { status: 504 });
      if (outcome === 'hold') await new Promise<void>((resolve) => { release = resolve; });
      return Response.json(INBOX);
    },
  }, { session: SESSION });
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not load notifications');
  const firstAttempt = alert.querySelector('time')?.getAttribute('dateTime');
  expect(firstAttempt).toBeTruthy();

  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })).toBeEnabled());
  const secondAttempt = screen.getByRole('alert').querySelector('time')?.getAttribute('dateTime');
  expect(secondAttempt).toBeTruthy();
  expect(secondAttempt).not.toBe(firstAttempt);

  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
  const retrying = await screen.findByRole('button', { name: 'Retrying…' });
  expect(retrying).toBeDisabled();
  release!();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Alex Example replied in Notes' })).toBeInTheDocument();
});

it('keeps loaded notifications when a refresh fails and treats a dropped live stream as a quiet status', async () => {
  const streams: Array<{ onerror: ((event: Event) => void) | null; onmessage: ((event: MessageEvent) => void) | null }> = [];
  vi.stubGlobal('EventSource', class {
    onopen = null; onmessage = null; onerror = null;
    constructor() { streams.push(this); }
    addEventListener() {}
    close() {}
  });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  let fail = false, reads = 0;
  stubFetch({
    '/api/my/people': () => { reads++; return fail ? Response.json({}, { status: 500 }) : Response.json(INBOX); },
  }, { session: SESSION });
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const link = await screen.findByRole('link', { name: 'Alex Example replied in Notes' });
  await waitFor(() => expect(streams.length).toBeGreaterThan(0));
  streams.at(-1)!.onerror?.(new Event('error'));
  expect(await screen.findByRole('status', { name: 'Live updates' })).toHaveTextContent('Reconnecting');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(link).toBeInTheDocument();

  const prior = reads;
  // Network recovery immediately follows a successful read, inside the ordinary focus debounce.
  window.dispatchEvent(new Event('online'));
  await waitFor(() => expect(streams.length).toBeGreaterThan(1));
  streams.at(-1)!.onmessage?.(new MessageEvent('message', {data:'{}'}));
  await waitFor(() => expect(reads).toBe(prior + 1));

  fail = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notifications');
  expect(screen.getByRole('link', { name: 'Alex Example replied in Notes' })).toBeInTheDocument();
});
