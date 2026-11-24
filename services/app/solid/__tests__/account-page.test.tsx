/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { stubFetch } from '@/test/helpers/fetch-stub';

const SESSION = { user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true };
/** Stubs the account page's reads: the session, the account (default: no photo), an empty inbox and the given tokens. */
function stubAccountFetch({ account = () => Response.json({ username: 'owner', image: null }), tokens = [], website = {roots:[],folders:[]}, calls }: {
  account?: () => Response | Promise<Response>; tokens?: unknown[]; website?: {roots:unknown[]; folders:unknown[]}; calls?: string[] } = {}) {
  stubFetch({
    '/api/page/account': account,
    '/api/my/website': website,
    '/api/my/people': { autoAccept: false, unread: 0, next: null, blocks: [{ user_id: 'blocked', name: 'Blocked Reader', username: 'handle' }], notifications: [] },
    '/api/my/tokens': { tokens },
  }, { session: SESSION, fallback: () => Response.json({}), onCall: (url, init) => { calls?.push(`${init?.method ?? 'GET'} ${url}`); } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('loads the account handle late while keeping profile controls without the retired data uploader', async () => {
  stubAccountFetch({ account: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ name: 'Sample Reader', username: 'owner', image: '/api/users/usr_1/avatar?v=1', user_page_url:'https://owner.u.example.test' }); } });
  window.history.replaceState(null, '', '/account');
  const view = render(() => <App />);
  await vi.dynamicImportSettled();
  expect(await screen.findByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('owner'));
  expect(screen.getByRole('textbox', {name:'Display name'})).toHaveValue('Sample Reader');
  expect(await screen.findByRole('region', { name: 'Notification settings' })).toHaveTextContent('Blocked Reader');
  expect(view.container.querySelector('[data-avatar-circle]')).toHaveTextContent('S');
  expect(view.container.querySelector('img[src="/api/users/usr_1/avatar?v=1"]')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  expect(await screen.findByRole('link',{name:'https://owner.u.example.test'})).toHaveAttribute('href','https://owner.u.example.test');
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/api/my/domain'))).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Data' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Upload a CSV')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Google Sheet URL')).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'HTTP authentication guide'})).toHaveAttribute('href','/llms/http-auth');
});

it('suggests an available label within the combined DNS budget and keeps it editable', async () => {
  const owner='a'.repeat(32),budget=63-owner.length-2,stem='b'.repeat(budget);
  const folders=['B'.repeat(80),'✨','  Mixed __ - Notes! '].map((title,i)=>({id:'f'+i,title,ancestor_ids:[]}));
  const roots=[stem,stem.slice(0,-2)+'-2'].map(subdomain_label=>({subdomain_label,folder_id:'f0'}));
  stubAccountFetch({account:()=>Response.json({username:owner,user_page_url:'https://'+owner+'.u.example.test'}),website:{roots,folders}});
  window.history.replaceState(null,'','/account');
  render(()=><App/>);
  fireEvent.click(await screen.findByRole('button',{name:'Add subdomain'}));
  const field=screen.getByLabelText('Website label');
  const select=(name:string)=>fireEvent.click(screen.getByRole('treeitem',{name:name.trim()}));
  select(folders[0]!.title);
  expect(field).toHaveValue(stem.slice(0,-2)+'-3');
  select(folders[1]!.title);
  expect(field).toHaveValue('folder');
  select(folders[2]!.title);
  expect(field).toHaveValue('mixed-notes');
  fireEvent.input(field,{target:{value:stem}});
  expect(screen.getByRole('button',{name:'Use this folder'})).toBeDisabled();
  expect(screen.getByText('This label is taken. Choose another label.')).toBeVisible();
  fireEvent.input(field,{target:{value:'custom'}});
  expect(screen.getByRole('button',{name:'Use this folder'})).toBeEnabled();
});

it('shows a managed handle and keeps the display name editable', async () => {
  stubAccountFetch({account: () => Response.json({username:'reader', managed_username:true, name:'Reader'})});
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  expect(await screen.findByText('Your sign-in provider manages this handle.')).toBeInTheDocument();
  expect(screen.getByText('@reader')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', {name:'Username'})).toBeNull();
  expect(screen.getByRole('textbox', {name:'Display name'})).toHaveValue('Reader');
});

// The accounts gate's claim leg, moved here: a verified account's page lists CLI connections to revoke, and nothing
// anywhere asks a person to paste a token.
it('asks a person for no pasted token anywhere on the account page', async () => {
  stubAccountFetch();
  window.history.replaceState(null, '', '/account');
  const view = render(() => <App />);
  await vi.dynamicImportSettled();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('owner'));
  expect(screen.queryByLabelText('Token to claim')).not.toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/mx_\.\.\./);
});

it('requires confirmation before revoking a connection', async () => {
  const calls: string[] = [];
  stubAccountFetch({ calls, tokens: [{ id: 'tok_1', name: 'Laptop', status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null }] });
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke token Laptop' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Agents using this token will stop working immediately');
  expect(calls).not.toContain('DELETE /api/my/tokens/tok_1');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await waitFor(() => expect(calls).toContain('DELETE /api/my/tokens/tok_1'));
});

it('labels a sign-in a service obtained for work it runs, beside the others, and revokes it the same way', async () => {
  const calls: string[] = [];
  stubAccountFetch({ calls, tokens: [
    { id: 'tok_run', name: 'run-warehouse', issued_by: 'warehouse', status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: '2027-01-01', last_used_at: null },
    { id: 'tok_1', name: 'Laptop', status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null },
  ] });
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  const row = await screen.findByRole('row', { name: 'Token row run-warehouse' });
  expect(row).toHaveTextContent('Signed in for work warehouse runs for you');
  expect(screen.getByRole('row', { name: 'Token row Laptop' })).not.toHaveTextContent('Signed in for work');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke token run-warehouse' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await waitFor(() => expect(calls).toContain('DELETE /api/my/tokens/tok_run'));
});

it('labels an agent signed in as a group with the group and level, not as the person, and revokes it the same way', async () => {
  const calls: string[] = [];
  stubAccountFetch({ calls, tokens: [
    { id: 'tok_group', name: 'group-editor', group: { id: 'grp_team', name: 'Team', role: 'editor' }, status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: '2027-01-01', last_used_at: null },
    { id: 'tok_1', name: 'Laptop', status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null },
  ] });
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  const row = await screen.findByRole('row', { name: 'Token row group-editor' });
  expect(row).toHaveTextContent('An agent acting as Team (editor), not as you');
  expect(screen.getByRole('row', { name: 'Token row Laptop' })).not.toHaveTextContent('acting as');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke token group-editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await waitFor(() => expect(calls).toContain('DELETE /api/my/tokens/tok_group'));
});

it('bounds connections to five rows and separates inactive history', async () => {
  const tokens = Array.from({ length: 12 }, (_, index) => ({ id: `tok_${index}`, name: `Connection ${index}`, status: index < 7 ? 'active' : 'expired', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null }));
  stubAccountFetch({ tokens });
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  expect(await screen.findByRole('button', { name: 'Active (7)' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(5);
  expect(screen.queryByRole('row', { name: 'Token row Connection 7' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next connections page' }));
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(2);
  expect(screen.getByRole('row', { name: 'Token row Connection 6' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History (5)' }));
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(5);
  expect(screen.getByRole('row', { name: 'Token row Connection 7' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous connections page' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Active (7)' }));
  expect(screen.getByRole('row', { name: 'Token row Connection 0' })).toBeInTheDocument();
});
