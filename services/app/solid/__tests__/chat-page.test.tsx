import { afbinInstallCommand } from '@/lib/serving/agent-discovery-tags';
/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';

const { write, scrollPages, scrollLines, scrollToBottom } = vi.hoisted(() => ({
  scrollPages: vi.fn(), scrollLines: vi.fn(), scrollToBottom: vi.fn(),
  write: vi.fn((data: string, callback?: () => void) => { if (data) callback?.(); }),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; write = write; scrollPages = scrollPages; scrollLines = scrollLines; scrollToBottom = scrollToBottom;
  loadAddon() {} open() {} resize() {} reset() {} dispose() {} onData() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 }; } } }));

import { ChatPage } from '@/solid/pages/Chat';

function open(session: string) {
  const history = createMemoryHistory();
  history.set({ value: `/chat?session=${session}`, replace: true });
  render(() => <MemoryRouter history={history}><Route path="/chat" component={ChatPage} /></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); write.mockClear(); window.history.replaceState(null, '', '/'); });

it('keeps polling through empty terminal frames and renders later output', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id: 'test', name: 'Demo', harness: 'claude', machine: 'laptop', online: true, controller: 'local', cols: 80, rows: 24, exitCode: null };
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/remote/sessions' ? { sessions: [session] } : ++calls === 1 ? { session, seq: 1, snapshot: '', frames: [] } : { session, seq: 2, frames: [{ seq: 2, cols: 80, rows: 24, data: 'later output' }] } })));
  open('test');
  await waitFor(() => expect(write).toHaveBeenCalledWith('later output', expect.any(Function)), { timeout: 2000 });
  expect(write).not.toHaveBeenCalledWith('', expect.any(Function));
});

it('shows an ended session without terminal input controls', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id: 'done', name: 'Claude', harness: 'claude', machine: 'laptop', online: false, controller: 'local', cols: 80, rows: 24, exitCode: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/remote/sessions' ? { sessions: [session] } : { session, seq: 1, snapshot: '', frames: [] } })));
  open('done');
  expect(await screen.findByText(/Session ended \(exit 0\)/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove session' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: 'Message to agent' })).toBeNull();
  expect(screen.getByText('claude · Ended')).toBeInTheDocument();
});

it('retries failed polls, clears reconnecting on recovery, and scrolls without sending input', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id: 'retry', name: 'Retry', harness: 'claude', machine: 'laptop', online: true, controller: 'local', cols: 80, rows: 24, exitCode: null };
  let polls = 0;
  const fetch = vi.fn(async (url: string) => { if (url === '/api/remote/sessions') return { ok: true, json: async () => ({ sessions: [session] }) }; polls++; if (polls <= 2) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => ({ session, seq: 1, snapshot: 'recovered output', frames: [] }) }; });
  vi.stubGlobal('fetch', fetch);
  open('retry');
  await waitFor(() => expect(screen.getAllByRole('status').map(el => el.textContent).join(' ')).toContain('Reconnecting'));
  await waitFor(() => expect(write).toHaveBeenCalledWith('recovered output', expect.any(Function)), { timeout: 3000 });
  await waitFor(() => expect(screen.queryByText(/Retrying automatically/)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Scroll up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scroll down' }));
  fireEvent.click(screen.getByRole('button', { name: 'Latest output' }));
  expect(scrollPages).toHaveBeenCalledWith(-1); expect(scrollPages).toHaveBeenCalledWith(1); expect(scrollToBottom).toHaveBeenCalled();
  const terminal = screen.getByLabelText('Remote terminal');
  fireEvent.touchStart(terminal, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(terminal, { touches: [{ clientY: 52 }] });
  expect(scrollLines).toHaveBeenCalledWith(3);
  fireEvent.touchMove(terminal, { touches: [{ clientY: 116 }] });
  expect(scrollLines).toHaveBeenCalledWith(-4);
  expect(fetch.mock.calls.every(call => !((call as unknown[])[1] as RequestInit)?.body)).toBe(true);
});

it('reloads a snapshot when relay generation changes even if the sequence is reused', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id: 'gen', name: 'Generation', harness: 'shell', machine: 'laptop', online: true, controller: 'local', cols: 80, rows: 24, exitCode: null };
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url === '/api/run-capabilities') return {ok:true,json:async()=>({version:1,managedProcesses:false})}; if (url === '/api/remote/sessions') return { ok: true, json: async () => ({ sessions: [session] }) }; urls.push(url); const n = urls.length; return { ok: true, json: async () => ({ session, seq: 1, generation: n === 1 ? 'old' : 'new', frames: [], ...(n === 1 ? { snapshot: 'old screen' } : url.endsWith('since=-1') ? { snapshot: 'restored screen' } : {}) }) }; }));
  open('gen');
  await waitFor(() => expect(write).toHaveBeenCalledWith('restored screen', expect.any(Function)));
  expect(urls.slice(0, 3)).toEqual(['/api/remote/sessions/gen?since=-1', '/api/remote/sessions/gen?since=1', '/api/remote/sessions/gen?since=-1']);
});

it.each([true, false])('uses stop only for online managed agents (online=%s)', async (online) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id: 'managed', name: 'Review', harness: 'codex', managed: true, online, activity: 'unknown', exitCode: null, cols: 80, rows: 24 };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === 'DELETE' || options?.method === 'POST' ? { ok: true } : url === '/api/remote/sessions' ? { sessions: [session] } : { session, seq: 0, frames: [] } }));
  vi.stubGlobal('fetch', fetch);
  open('managed');
  fireEvent.click(await screen.findByRole('button', { name: online ? 'Stop agent' : 'Remove agent' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/remote/sessions/managed', expect.objectContaining({ method: online ? 'POST' : 'DELETE' })));
  if (!online) await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Review' })).toBeNull());
});


it('keeps offline and ended sessions behind history without hiding a directly opened session', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const base = { harness: 'pi', machine: 'Hosted', cols: 80, rows: 24, controller: 'local', exitCode: null };
  const sessions = [
    { ...base, id: 'hosted', name: 'artifactbin', online: true },
    { ...base, id: 'offline', name: 'Offline agent', online: false },
    { ...base, id: 'ended', name: 'Old review', online: false, exitCode: 0 },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/remote/sessions' ? { sessions } : { session: sessions.find(s => url.includes(s.id)) ?? sessions[0], seq: 0, frames: [] } })));
  open('hosted');
  expect(await screen.findByRole('button', { name: 'Open artifactbin' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open Old review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Offline agent' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show previous sessions (2)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Old review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open Old review' })).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Hide previous sessions (2)' }));
  expect(screen.getByRole('button', { name: 'Open Old review' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Open Offline agent' })).toBeNull();
});

it('keeps install and remote startup commands on the app origin', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) })));
  open('');
  expect(screen.getByText(afbinInstallCommand(window.location.origin), { normalizer: text => text })).toBeInTheDocument();
  expect(screen.getByText(`npx --yes @afbin/cli@latest remote --server '${window.location.origin}' claude`)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose your agent' }), { target: { value: 'codex' } });
  expect(screen.getByText(`npx --yes @afbin/cli@latest remote --server '${window.location.origin}' codex`)).toBeInTheDocument();
});

it('offers native hosted boxes only when the configured service advertises managed processes',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'native',runId:'run-one',name:'my-agent',harness:'codex',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null};
 const fetch=vi.fn(async(url:string,_options?:RequestInit)=>({ok:true,json:async()=>url==='/api/run-capabilities'?{version:1,managedProcesses:true}:url==='/api/runs'?{session,runId:'run-one'}:url==='/api/remote/sessions'?{sessions:[]}:{session,seq:0,frames:[],snapshot:'Log in to Codex'}}));
 vi.stubGlobal('fetch',fetch);open('');
 const program=await screen.findByRole('combobox',{name:'Hosted program'});fireEvent.change(program,{target:{value:'codex'}});
 fireEvent.input(screen.getByRole('textbox',{name:'SSH public key'}),{target:{value:'ssh-ed25519 fixture-only'}});
 fireEvent.click(screen.getByRole('button',{name:'Start hosted box'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/runs',expect.objectContaining({method:'POST'})));
 const call=fetch.mock.calls.find(([url])=>url==='/api/runs')!;
 expect(JSON.parse(call[1]!.body as string)).toMatchObject({name:'my-agent',command:['codex'],sshPublicKey:'ssh-ed25519 fixture-only',compute:{vcpu:1,memoryMiB:2048}});
 await waitFor(()=>expect(write).toHaveBeenCalledWith('Log in to Codex',expect.any(Function)));
});

it('switches native terminal layout without sending unsupported PTY resize controls',async()=>{
 let resized=()=>{};vi.stubGlobal('ResizeObserver',class {constructor(callback:()=>void){resized=callback;}observe(){}disconnect(){}});
 const session={id:'native-fixed',runId:'run-fixed',name:'Fixed',harness:'bash',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null};
 const fetch=vi.fn(async(url:string,_options?:RequestInit)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:{session,seq:1,frames:[],snapshot:'native fixed terminal'}}));
 vi.stubGlobal('fetch',fetch);open(session.id);
 const toggle=await screen.findByRole('button',{name:'Switch to mobile'});await waitFor(()=>expect(toggle).toBeEnabled());
 resized();fireEvent.click(toggle);const desktop=await screen.findByRole('button',{name:'Switch to desktop'});await waitFor(()=>expect(desktop).toBeEnabled());
 expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(0);
});
