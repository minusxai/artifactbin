/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('opens the bell and shows an invitation with a working approval action', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 1, next: null, blocks: [], notifications: [{ id: 'n1', artifact_id: 'doc1', user_id: 'usr_1', status: 'pending', direction: 'request', sender_id: 'usr_2', username: 'alice', kind: 'request', source: null, title: 'Notes', read_at: null, revision: 1 }] });
    if (url === '/api/my/artifacts/doc1/members') return Response.json({});
    return Response.json({}, { status: 404 });
  }));
  window.history.replaceState(null, '', '/notifications');
  render(() => <App />);
  const bell = await screen.findByRole('button', { name: 'Notifications, unread updates' });
  fireEvent.click(bell);
  expect(screen.getByRole('region', { name: 'Notification list' })).toHaveTextContent('alice');
  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
  await waitFor(() => expect(calls).toContainEqual({ url: '/api/my/artifacts/doc1/members', method: 'POST' }));
});

it('labels an agent reply without showing an unrelated accepted invitation status', async () => {
 vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if(url==='/api/page/session')return Response.json({user:{id:'usr_1',email:'a@example.com',username:'owner',image:null},kind:'account',onboarded:true});
  if(url==='/api/my/people')return Response.json({autoAccept:false,unread:1,next:null,blocks:[],notifications:[
   {id:'reply',artifact_id:'doc1',user_id:'usr_1',status:'accepted',direction:'owner',sender_id:'usr_1',username:'owner',agent_label:'afbin',kind:'reply',source:'comment:thread',title:'Notes',read_at:null,revision:1},
   {id:'invite',artifact_id:'doc2',user_id:'usr_1',status:'accepted',direction:'invitation',sender_id:'usr_2',username:'alice',kind:'invitation',source:null,title:'Shared',read_at:null,revision:1}
  ]});
  return Response.json({}, {status:404});
 }));
 window.history.replaceState(null,'','/notifications');render(()=><App/>);
 const link=await screen.findByRole('link',{name:'@afbin replied in Notes'});
 expect(link.closest('li')).not.toHaveTextContent('Invitation accepted');
 expect(screen.getByRole('link',{name:'@alice invited you to Shared'}).closest('li')).toHaveTextContent('Invitation accepted');
});
