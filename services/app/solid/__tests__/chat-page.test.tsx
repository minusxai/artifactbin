/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';

const { write, scrollPages, scrollLines, scrollToBottom, terminalInput } = vi.hoisted(() => ({
  scrollPages: vi.fn(), scrollLines: vi.fn(), scrollToBottom: vi.fn(), terminalInput: { send: (_value: string) => {} },
  write: vi.fn((data: string, callback?: () => void) => { if (data) callback?.(); }),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; write = write; scrollPages = scrollPages; scrollLines = scrollLines; scrollToBottom = scrollToBottom;
  loadAddon() {} open() {} resize() {} reset() {} dispose() {} onData(callback: (value: string) => void) { terminalInput.send = callback; return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 }; } } }));

import { ChatPage } from '@/solid/pages/Chat';
import { AGENT_PALETTE } from '@/solid/lib/agent-identity';

const metadataMatch = (text:string) => (_content:string, node:Element|null) => node?.tagName === 'P' && node.textContent === text;
const sidebar = () => within(screen.getByRole('complementary', {name:'Agents'}));

function open(session: string) {
  const history = createMemoryHistory();
  history.set({ value: `/chat?session=${session}`, replace: true });
  render(() => <MemoryRouter history={history}><Route path="/chat" component={ChatPage} /></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); write.mockClear(); window.history.replaceState(null, '', '/'); });

it('relays terminal keystrokes without forwarding generated protocol replies', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = {id:'terminal-replies',name:'Codex',harness:'codex',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null,runId:'terminal-run',managed:true,activity:'listening'};
  const inputs: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url:string,options?:RequestInit) => {
    if(options?.method==='POST') { const input=JSON.parse(String(options.body)); if(input.type==='input') inputs.push(input.data); }
    return {ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{managedProcesses:true}:{session,seq:0,frames:[],snapshot:''}};
  }));
  open(session.id);
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeEnabled());
  for(const reply of ['\x1b[?1;2c','\x1b[>0;276;0c','\x1b[1;1R','\x1b[0n','\x1b[8;30;100t','\x1b]10;rgb:1111/2222/3333\x1b\\']) terminalInput.send(reply);
  for(const key of ['hello','\x1b[A','\r']) terminalInput.send(key);
  await waitFor(()=>expect(inputs).toEqual(['hello','\x1b[A','\r']));
});

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
  const endedNotice = await screen.findByText(/Session ended \(exit 0\)/, { selector: '[role="status"]' });
  expect(endedNotice).toBeInTheDocument();
  expect(endedNotice).toHaveTextContent('Start a new session with afbin remote to reconnect.');
  expect(screen.getByRole('button', { name: 'Remove session' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: 'Message to agent' })).toBeNull();
  expect(screen.getByText('claude · Ended')).toBeInTheDocument();
});

it('labels hosted runner lifecycle separately from local online status', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const make = (id:string,activity:string) => ({ id,name:id,harness:'codex',machine:'hosted',online:activity==='working',controller:'web',cols:100,rows:30,exitCode:null,runId:`run-${id}`,managed:true,activity });
  const sessions = [make('box-starting','starting'),make('box-running','working'),make('box-stopping','stopping'),make('box-ended','stopped'),make('box-unknown','unknown')];
  vi.stubGlobal('fetch', vi.fn(async (url:string) => ({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions}:url==='/api/run-capabilities'?{managedProcesses:false}:{session:sessions[1],seq:1,snapshot:'',frames:[]} })));
  open('box-running');
  expect(await screen.findByText('codex · Online · Running')).toBeInTheDocument();
  expect(screen.getByText('codex · Starting')).toBeInTheDocument();
  expect(screen.getByText('codex · Stopping')).toBeInTheDocument();
  expect(screen.queryByText('codex · Online')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Show previous sessions (2)'}));
  expect(screen.getByText('codex · Ended')).toBeInTheDocument();
  expect(screen.getByText('codex · Offline')).toBeInTheDocument();
});

it.each(['listening','unknown'])('shows a connected hosted agent without calling its %s readiness offline', async (activity) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id:'hosted-ready',name:'Claude',harness:'claude',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null,runId:'run-ready',managed:true,activity };
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{managedProcesses:true}:{session,seq:0,frames:[],snapshot:''}})));
  open(session.id);
  const status=activity==='listening'?'Online · Ready':'Online · Waiting for readiness';
  expect(await screen.findByRole('button',{name:'Open Claude'})).toHaveTextContent('claude · '+status);
  expect(await screen.findByText(metadataMatch(status+' · claude · Cloud box'))).toBeInTheDocument();
  expect(screen.queryByText('claude · Offline')).toBeNull();
  expect(screen.queryByText('claude · Unavailable')).toBeNull();
  expect(screen.queryByRole('button',{name:'Resume artifact requests'})).toBeNull();
});

it('offers an explicit owner readiness action for an online native managed agent waiting after manual input', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id:'owner-ready',name:'Claude',harness:'claude',machine:'laptop',online:true,controller:'web',cols:80,rows:24,exitCode:null,managed:true,activity:'unknown' };
  let activity=session.activity,resolvePost:(()=>void)|undefined;
  const fetch = vi.fn(async (url:string,options?:RequestInit) => {
    if(url==='/api/remote/sessions')return {ok:true,json:async()=>({sessions:[session]})};
    if(options?.method==='POST')return new Promise<{ok:boolean,json:()=>Promise<{ok:boolean}>}>(resolve=>{resolvePost=()=>resolve({ok:true,json:async()=>({ok:true})});});
    return {ok:true,json:async()=>({session:{...session,activity},seq:0,frames:[],snapshot:''})};
  });
  vi.stubGlobal('fetch',fetch);
  open(session.id);
  expect(await screen.findByText('Use this only after the agent has finished the manual task and no approval is pending.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Resume artifact requests'}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/remote/sessions/owner-ready',expect.objectContaining({method:'POST',body:JSON.stringify({type:'resume-artifact-work'})})));
  activity='working';
  expect(await screen.findByText(metadataMatch('Online · Running · claude · laptop'))).toBeInTheDocument();
  resolvePost?.();
  expect(await screen.findByText(metadataMatch('Online · Running · claude · laptop'))).toBeInTheDocument();
});

it.each([
  {id:'offline-owner-ready',online:false,activity:'unknown',managed:true},
  {id:'ended-owner-ready',online:false,activity:'stopped',managed:true,exitCode:0},
  {id:'hosted-owner-ready',online:true,activity:'unknown',managed:true,runId:'hosted-run'},
  {id:'unmanaged-owner-ready',online:true,activity:'unknown',managed:false},
])('does not offer owner readiness recovery for an ineligible session (%s)', async session => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const selected = {name:'Review',harness:'claude',machine:'laptop',controller:'web',cols:80,rows:24,exitCode:null,...session};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[selected]}:{session:selected,seq:0,frames:[],snapshot:''}})));
  open(selected.id);
  await screen.findByRole('button',{name:/Open Review/});
  expect(screen.queryByRole('button',{name:'Resume artifact requests'})).toBeNull();
});

it('lets the user stop waiting and start again with a fresh client wait', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let starts=0;
  const fetch=vi.fn(async (url:string) => {
    if(url==='/api/run-capabilities')return {ok:true,json:async()=>({version:1,managedProcesses:true})};
    if(url==='/api/remote/sessions')return {ok:true,json:async()=>({sessions:[]})};
    if(url==='/api/runs')return ++starts===1
      ? {ok:false,status:409,headers:new Headers({'Retry-After':'1'}),json:async()=>({error:'box_restart_pending'})}
      : {ok:true,status:202,headers:new Headers(),json:async()=>({session:{id:'fresh-run',name:'my-agent',harness:'bash',machine:'hosted',online:false,exitCode:null,controller:'web',cols:100,rows:30,runId:'fresh-run'}})};
    return {ok:true,json:async()=>({session:null,seq:0,frames:[]})};
  });
  vi.stubGlobal('fetch',fetch);
  open('');
  await waitFor(() => expect(sidebar().getByRole('button', {name:'Provision cloud agent'})).toBeEnabled());
 fireEvent.click(sidebar().getByRole('button', {name:'Provision cloud agent'}));
  fireEvent.click(await screen.findByRole('button',{name:'Start hosted box'}));
  fireEvent.click(await screen.findByRole('button',{name:'Stop waiting'}));
  expect(await screen.findByText(/Check your sessions before starting again/)).toBeInTheDocument();
  // Cross the server's retry delay: a canceled wait must never send admission again.
  await new Promise(resolve=>setTimeout(resolve,1100));
  expect(starts).toBe(1);
  fireEvent.click(await screen.findByRole('button',{name:'Start hosted box'}));
  await waitFor(()=>expect(starts).toBe(2));
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

it('keeps connection commands on demand without installation instructions', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) })));
  open('');
  expect(screen.queryByRole('heading', {name:'Connected Agents'})).toBeNull();
  expect(screen.getByRole('region', {name:'Local agents'})).toHaveTextContent('No connected local agents');
  expect(screen.getByRole('region', {name:'Cloud agents'})).toHaveTextContent('No cloud agents yet');
  expect(screen.queryByText('Install CLI')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Claude Code' })).toBeNull();
  const trigger = sidebar().getByRole('button', {name:'Connect your agent'});
  expect(screen.getByRole('region', {name:'Local agents'})).toContainElement(trigger);
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', {name:'Connect your agent'})).toHaveAttribute('aria-modal','true');
  expect(screen.getByRole('main')).not.toContainElement(screen.getByRole('dialog'));
  const localName = screen.getByRole('textbox', {name:'Agent name'});
  expect((localName as HTMLInputElement).value).toMatch(/^[a-z]+-[0-9a-f]{6}$/);
  fireEvent.input(localName, {target:{value:'otter-12ab34'}});
  expect(screen.getByText(`afbin remote --server '${window.location.origin}' --name otter-12ab34 claude`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(`afbin remote --server '${window.location.origin}' --name otter-12ab34 codex`)).toBeInTheDocument();
  fireEvent.input(localName, {target:{value:'bad; command'}});
  expect(screen.queryByRole('button', {name:'Copy run in your terminal'})).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Use 1–32');
  fireEvent.keyDown(window, {key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  fireEvent.click(within(screen.getByRole('region', {name:'No agent selected'})).getByRole('button', {name:'Connect your agent'}));
  expect(screen.getByRole('dialog', {name:'Connect your agent'})).toBeInTheDocument();
});

it('offers native hosted boxes only when the configured service advertises managed processes',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'native',runId:'run-one',name:'my-agent',harness:'codex',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null};
 const fetch=vi.fn(async(url:string,_options?:RequestInit)=>({ok:true,json:async()=>url==='/api/run-capabilities'?{version:1,managedProcesses:true}:url==='/api/runs'?{session,runId:'run-one'}:url==='/api/remote/sessions'?{sessions:[]}:{session,seq:0,frames:[],snapshot:'Log in to Codex'}}));
 vi.stubGlobal('fetch',fetch);open('');
 const provision = sidebar().getByRole('button', {name:'Provision cloud agent'});
 await waitFor(() => expect(provision).toBeEnabled());
 expect(screen.getByRole('region',{name:'Cloud agents'})).toContainElement(provision);
 fireEvent.click(provision);
 expect(screen.getByRole('dialog',{name:'Provision cloud agent'})).toHaveAttribute('aria-modal','true');
 const agentName = screen.getByRole('textbox', {name:'Agent name'});
 expect((agentName as HTMLInputElement).value).toMatch(/^[a-z]+-[0-9a-f]{6}$/);
 expect(AGENT_PALETTE).toContain('#' + (agentName as HTMLInputElement).value.split('-').at(-1));
 fireEvent.input(agentName, {target:{value:'koala'}});
 const color = screen.getByRole('img', {name:/Agent color #[0-9a-f]{6}/}).getAttribute('aria-label');
 expect(AGENT_PALETTE).toContain(color?.replace('Agent color ', ''));
 fireEvent.input(agentName, {target:{value:'otter'}});
 expect(screen.getByRole('img', {name:/Agent color #[0-9a-f]{6}/})).not.toHaveAttribute('aria-label',color);
 fireEvent.input(agentName, {target:{value:'koala'}});
 expect(screen.getByRole('img', {name:/Agent color #[0-9a-f]{6}/})).toHaveAttribute('aria-label',color);
 fireEvent.input(agentName, {target:{value:'koala-a234f4'}});
 expect(screen.getByRole('img', {name:'Agent color #a234f4'})).toHaveStyle({'background-color':'#a234f4'});
 fireEvent.click(screen.getByRole('button', {name:'Codex'}));
 expect(screen.getByRole('button', {name:'Codex'})).toHaveAttribute('aria-pressed','true');
 fireEvent.input(screen.getByRole('textbox',{name:'SSH public key'}),{target:{value:'ssh-ed25519 fixture-only'}});
 fireEvent.click(screen.getByRole('button',{name:'Start hosted box'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/runs',expect.objectContaining({method:'POST'})));
 const call=fetch.mock.calls.find(([url])=>url==='/api/runs')!;
 expect(JSON.parse(call[1]!.body as string)).toMatchObject({name:'koala-a234f4',command:['codex'],sshPublicKey:'ssh-ed25519 fixture-only',compute:{vcpu:1,memoryMiB:2048}});
 await waitFor(()=>expect(write).toHaveBeenCalledWith('Log in to Codex',expect.any(Function)));
});

it('retries a stopped-box admission with one frozen request and visible progress',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'native-restarted',runId:'run-two',name:'my-agent',harness:'codex',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null};
 const bodies:string[]=[];let attempts=0;
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url==='/api/run-capabilities')return {ok:true,json:async()=>({version:1,managedProcesses:true})};
  if(url==='/api/runs'){
   bodies.push(options?.body as string);attempts++;
   return attempts===1?{ok:false,status:409,headers:new Headers({'Retry-After':'0.001'}),json:async()=>({error:'box_restart_pending'})}:{ok:true,status:202,headers:new Headers(),json:async()=>({session,runId:'run-two'})};
  }
  if(url==='/api/remote/sessions')return {ok:true,json:async()=>({sessions:[]})};
  return {ok:true,json:async()=>({session,seq:0,frames:[],snapshot:'ready'})};
 });
 vi.stubGlobal('fetch',fetch);open('');
 await waitFor(() => expect(sidebar().getByRole('button', {name:'Provision cloud agent'})).toBeEnabled());
 fireEvent.click(sidebar().getByRole('button', {name:'Provision cloud agent'}));
 const name=await screen.findByRole('textbox',{name:'Agent name'});
 fireEvent.click(screen.getByRole('button',{name:'Start hosted box'}));
 expect(await screen.findByText('Finishing the previous hosted box…')).toBeInTheDocument();
 expect(name).toBeDisabled();expect(screen.getByRole('button',{name:'Shell'})).toBeDisabled();expect(screen.getByRole('button',{name:'Codex'})).toBeDisabled();
 await waitFor(()=>expect(attempts).toBe(2));
 expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);
 expect(JSON.parse(bodies[0]!).requestId).toBeTruthy();
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

it('can stop a hosted run whose terminal history is unavailable without removing its session',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'history-unavailable',runId:'still-running',name:'Retained shell',harness:'bash',machine:'Hosted',managed:true,online:false,activity:'unknown',exitCode:null,cols:80,rows:24};
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='POST'?{ok:true}:url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{managedProcesses:true}:{session,seq:0,snapshot:'Earlier terminal output cannot be safely restored. Your hosted shell is still running.',frames:[]}}));
 vi.stubGlobal('fetch',fetch);open(session.id);
 fireEvent.click(await screen.findByRole('button',{name:'Stop agent'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/remote/sessions/history-unavailable',expect.objectContaining({method:'POST'})));
 const stop=fetch.mock.calls.find(([,options])=>options?.method==='POST')!;
 expect(JSON.parse(stop[1]!.body as string)).toEqual({type:'stop'});
 expect(fetch.mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
});

it.each([
 {activity:'stopping',exitCode:null,label:'Stop agent',disabled:true},
 {activity:'stopped',exitCode:null,label:'Remove agent',disabled:false},
 {activity:'stopped',exitCode:0,label:'Remove session',disabled:false},
])('keeps hosted $activity recovery controls truthful (exit=$exitCode)',async({activity,exitCode,label,disabled})=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'hosted-state',runId:'native-state',name:'Hosted state',harness:'bash',machine:'Hosted',managed:true,online:false,activity,exitCode,cols:80,rows:24};
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='DELETE'?{ok:true}:url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{managedProcesses:false}:{session,seq:0,snapshot:'',frames:[]}}));
 vi.stubGlobal('fetch',fetch);open(session.id);
 const action=await screen.findByRole('button',{name:label});
 if(disabled){expect(action).toBeDisabled();expect(action).toHaveTextContent('Stopping…');}
 else{
  expect(action).toBeEnabled();fireEvent.click(action);
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/remote/sessions/hosted-state',expect.objectContaining({method:'DELETE'})));
 }
 expect(fetch.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
});

it('guides an ended hosted run back to Start hosted box with retained home files',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'hosted-ended-copy',runId:'ended-run',name:'Retained shell',harness:'bash',machine:'Hosted',managed:true,online:false,activity:'stopped',exitCode:0,cols:80,rows:24};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{version:1,managedProcesses:true}:{session,seq:0,snapshot:'',frames:[]}})));
 open(session.id);const endedNotice=await screen.findByText(/Session ended \(exit 0\)/,{selector:'[role="status"]'});
 expect(endedNotice).toHaveTextContent(/Start hosted box/);expect(endedNotice).toHaveTextContent(/same name/);expect(endedNotice).toHaveTextContent(/home files/i);
 expect(endedNotice).not.toHaveTextContent('afbin remote');expect(screen.getByRole('button',{name:'Remove session'})).toBeEnabled();
 await waitFor(() => expect(sidebar().getByRole('button', {name:'Provision cloud agent'})).toBeEnabled());
 fireEvent.click(sidebar().getByRole('button', {name:'Provision cloud agent'}));
 expect(screen.getByRole('button',{name:'Start hosted box'})).toBeEnabled();
});


it('updates the selected sidebar from the terminal connection instead of waiting for the slower list poll', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id:'fresh-connection',name:'Fresh Claude',harness:'claude',machine:'Hosted',online:true,controller:'web',cols:100,rows:30,exitCode:null,runId:'fresh-run',managed:true,activity:'blocked' };
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[{...session,online:false}]}:url==='/api/run-capabilities'?{managedProcesses:false}:{session,seq:0,frames:[],snapshot:''}})));
  open(session.id);
  expect(await screen.findByText(metadataMatch('Online · Waiting for approval · claude · Cloud box'))).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Open Fresh Claude'})).toHaveTextContent('claude · Online · Waiting for approval');
});

it.each(['pi', 'opencode'])('offers and starts hosted %s with the selected harness', async (harness) => {
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const session={id:'new-agent',name:'my-agent',harness,machine:'Hosted',online:false,runId:'new-run',activity:'starting',exitCode:null,cols:100,rows:30};
  const fetch=vi.fn(async(url:string)=>({ok:true,status:202,headers:new Headers(),json:async()=>url==='/api/run-capabilities'?{version:1,managedProcesses:true}:url==='/api/remote/sessions'?{sessions:[]}:url==='/api/runs'?{session}:{session,seq:0,frames:[],snapshot:''}}));
  vi.stubGlobal('fetch',fetch);open('');
  await waitFor(()=>expect(sidebar().getByRole('button',{name:'Provision cloud agent'})).toBeEnabled());
  fireEvent.click(sidebar().getByRole('button',{name:'Provision cloud agent'}));
  fireEvent.click(await screen.findByRole('button',{name:harness==='pi'?'Pi':'OpenCode'}));fireEvent.click(screen.getByRole('button',{name:'Start hosted box'}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/runs',expect.objectContaining({body:expect.stringContaining('"command":["'+harness+'"]')})));
  const loginHelp=await screen.findByText(/Sign in from this terminal/);
  expect(loginHelp).not.toHaveTextContent('in a shell');
  if(harness==='opencode')expect(loginHelp).toHaveTextContent('To refresh an existing OpenCode login, run opencode auth login in a Shell agent, then restart OpenCode.');
});


it('shows the same offline state in the selected header and list while keeping recovery guidance', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = { id:'offline-connection',name:'Offline Claude',harness:'claude',machine:'Hosted',online:false,controller:'web',cols:100,rows:30,exitCode:null,runId:'offline-run',managed:true,activity:'unknown' };
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:url==='/api/run-capabilities'?{managedProcesses:false}:{session,seq:0,frames:[],snapshot:''}})));
  open(session.id);
  expect(await screen.findByRole('button',{name:'Open Offline Claude'})).toHaveTextContent('claude · Offline');
  expect(await screen.findByText(metadataMatch('Offline · claude · Cloud box'))).toBeInTheDocument();
  expect(screen.getByText('Waiting for your hosted terminal…')).toBeInTheDocument();
});

it('shows one stopping state and disables input while a stop receipt and terminal poll are pending',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'stop-transition',runId:'native-transition',name:'Transition',harness:'claude',machine:'Hosted',managed:true,online:true,activity:'listening',exitCode:null,cols:100,rows:30};
 let completeStop!:(value:unknown)=>void;
 const receipt=new Promise(resolve=>{completeStop=resolve;});
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>options?.method==='POST'?receipt:{ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:{session,seq:0,snapshot:'Ready',frames:[]}}));
 open(session.id);
 await screen.findByText(metadataMatch('Online · Ready · claude · Cloud box'));
 fireEvent.click(screen.getByRole('button',{name:'Stop agent'}));
 await waitFor(()=>expect(screen.getByText(metadataMatch('Stopping · claude · Cloud box'))).toBeInTheDocument());
 expect(screen.getByText('claude · Stopping')).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Send Enter'})).toBeDisabled();
 terminalInput.send('must not reach shutdown');
 completeStop({ok:true,json:async()=>({ok:true})});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Stop agent'})).toBeDisabled());
 expect(screen.getByText(metadataMatch('Stopping · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Stopping')).toBeInTheDocument();
});


it('keeps stopping through stale polls, blocks raw terminal input, and accepts a confirmed ended state', async () => {
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 let session={id:'stop-latched',runId:'native-latched',name:'Latched',harness:'claude',machine:'Hosted',managed:true,online:true,activity:'listening',exitCode:null as number|null,cols:100,rows:30};
 let polls=0;
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='POST'?{ok:true}:url==='/api/remote/sessions'?{sessions:[session]}:(polls++,{session,seq:0,snapshot:'Ready',frames:[]})}));
 vi.stubGlobal('fetch',fetch);open(session.id);
 await screen.findByText(metadataMatch('Online · Ready · claude · Cloud box'));
 const pollsAtStop = polls;
 fireEvent.click(screen.getByRole('button',{name:'Stop agent'}));
 await waitFor(()=>expect(polls).toBeGreaterThan(pollsAtStop));
 expect(screen.getByText(metadataMatch('Stopping · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Stopping')).toBeInTheDocument();
 terminalInput.send('shutdown input');
 fireEvent.submit(screen.getByRole('textbox',{name:'Message to agent'}).closest('form')!);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
 session={...session,online:false,activity:'stopped',exitCode:0};
 expect(await screen.findByText(metadataMatch('Ended · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Ended')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Remove session'})).toBeEnabled();
});

it('restores the latest usable session and shows the error when Stop fails', async () => {
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'stop-failed',runId:'native-failed',name:'Retry Stop',harness:'claude',machine:'Hosted',managed:true,online:true,activity:'listening',exitCode:null,cols:100,rows:30};
 let rejectStop!:(reason:unknown)=>void;
 const receipt=new Promise((_resolve,reject)=>{rejectStop=reject;});
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>options?.method==='POST'?receipt:{ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:{session,seq:0,snapshot:'Ready',frames:[]}});
 vi.stubGlobal('fetch',fetch);open(session.id);
 await screen.findByText(metadataMatch('Online · Ready · claude · Cloud box'));
 fireEvent.click(screen.getByRole('button',{name:'Stop agent'}));
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
 rejectStop(new Error('Stop could not be confirmed'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Stop could not be confirmed');
 expect(screen.getByText(metadataMatch('Online · Ready · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Online · Ready')).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Stop agent'})).toBeEnabled();
});


it('shows capacity waiting consistently, disables input, and transitions through startup to Ready',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 let session={id:'capacity-wait',runId:'capacity-run',name:'Capacity Claude',harness:'claude',machine:'Hosted',managed:true,online:false,activity:'queued',exitCode:null,cols:100,rows:30};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions:[session]}:{session,seq:0,snapshot:'Waiting for compute capacity. Your agent will start automatically when a slot is available.',frames:[]}})));
 open(session.id);
 expect(await screen.findByText(metadataMatch('Waiting for capacity · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Waiting for capacity')).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Agents'}).parentElement).toHaveTextContent('1 active');
 expect(screen.getByRole('heading',{name:'Agents'}).parentElement).not.toHaveTextContent('connected');
 expect(screen.getByText('Waiting for compute capacity. Your agent will start automatically when a slot is available.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Show previous sessions/})).toBeNull();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toHaveAttribute('placeholder','Waiting for capacity…');
 expect(screen.getByRole('button',{name:'Stop agent'})).toBeEnabled();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Send Enter'})).toBeDisabled();
 session={...session,online:true};
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled());
 expect(screen.getByText(metadataMatch('Waiting for capacity · claude · Cloud box'))).toBeInTheDocument();
 session={...session,online:false,activity:'starting'};
 expect(await screen.findByText(metadataMatch('Starting · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
 session={...session,online:true,activity:'listening'};
 expect(await screen.findByText(metadataMatch('Online · Ready · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Online · Ready')).toBeInTheDocument();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeEnabled();
 expect(screen.queryByText('Waiting for compute capacity. Your agent will start automatically when a slot is available.')).toBeNull();
});

it('can cancel a capacity-waiting agent and keeps Stop above stale queued polls',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const session={id:'capacity-stop',runId:'capacity-stop-run',name:'Cancel Queued',harness:'claude',machine:'Hosted',managed:true,online:false,activity:'queued',exitCode:null,cols:100,rows:30};
 let polls=0;
 const fetch=vi.fn(async(url:string,options?:RequestInit)=>({ok:true,json:async()=>options?.method==='POST'?{ok:true}:url==='/api/remote/sessions'?{sessions:[session]}:(polls++,{session,seq:0,snapshot:'',frames:[]})}));
 vi.stubGlobal('fetch',fetch);open(session.id);
 await screen.findByText(metadataMatch('Waiting for capacity · claude · Cloud box'));
 const pollsAtStop=polls;fireEvent.click(screen.getByRole('button',{name:'Stop agent'}));
 await waitFor(()=>expect(polls).toBeGreaterThan(pollsAtStop));
 expect(screen.getByText(metadataMatch('Stopping · claude · Cloud box'))).toBeInTheDocument();
 expect(screen.getByText('claude · Stopping')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Stop agent'})).toBeDisabled();
 expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
 expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
});

it('keeps the included agent visible offline and identifies it without treating local Pi as included', async () => {
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
 const base = { harness:'pi',machine:'Hosted',cols:80,rows:24,controller:'web',exitCode:null };
 const sessions = [{...base,id:'included',name:'afbin',included:true,online:false}, {...base,id:'local-pi',name:'My Pi',online:true}];
 vi.stubGlobal('fetch', vi.fn(async (url:string) => ({ok:true,json:async()=>url==='/api/remote/sessions'?{sessions}:url==='/api/run-capabilities'?{version:1,managedProcesses:false}:{session:sessions[0],seq:0,frames:[]} })));
 open('included');
 expect(await screen.findByRole('button',{name:'Open afbin'})).toHaveTextContent('Included for free');
 expect(screen.getByRole('region',{name:'Cloud agents'})).toContainElement(screen.getByRole('button',{name:'Open afbin'}));
 expect(screen.getByRole('region',{name:'Local agents'})).toContainElement(screen.getByRole('button',{name:'Open My Pi'}));
 expect(screen.getByRole('button',{name:'Open My Pi'})).not.toHaveTextContent('Included');
 expect(screen.getByText(/Your included Pi agent/)).toBeInTheDocument();
 expect(sidebar().getByRole('button', {name:'Provision cloud agent'})).toBeDisabled();
});


it('releases included agent Stop only after a fresh post-acknowledgement poll and accepts new work', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const session = {id:'included-stop',name:'afbin',harness:'pi',machine:'Hosted',included:true,managed:true,online:true,controller:'web',cols:100,rows:30,exitCode:null,activity:'working'};
  let polls=0, acknowledge!:()=>void, stale!:()=>void, stopPosted=false, inputCount=0;
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url==='/api/run-capabilities')return {ok:true,json:async()=>({managedProcesses:true})};
    if(url==='/api/remote/sessions')return {ok:true,json:async()=>({sessions:[session]})};
    if(init?.method==='POST'){
      const body=JSON.parse(String(init.body));
      if(body.type==='stop'){stopPosted=true;await new Promise<void>(resolve=>{acknowledge=resolve;});}
      if(body.type==='input')inputCount++;
      return {ok:true,json:async()=>({})};
    }
    const n=++polls;
    if(n===2)await new Promise<void>(resolve=>{stale=resolve;});
    return {ok:true,json:async()=>({session:{...session,activity:n>=3?'listening':'working'},seq:n,frames:n===2?[{seq:n,cols:100,rows:30,data:'stale pre-stop response'}]:[],...(n===1?{snapshot:''}:{})})};
  });
  vi.stubGlobal('fetch',fetch);open(session.id);
  await waitFor(()=>expect(polls).toBe(2));
  expect(screen.getByText(/Stop current work cancels current and queued requests and keeps your agent available/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Stop current work'}));
  await waitFor(()=>expect(stopPosted).toBe(true));
  acknowledge();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Stop current work'})).toHaveTextContent('Stopping…'));
  stale();
  await waitFor(()=>expect(write).toHaveBeenCalledWith('stale pre-stop response',expect.any(Function)));
  expect(polls).toBe(2);
  expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Open afbin'})).toHaveTextContent('Stopping');
  expect(screen.getByRole('textbox',{name:'Message to agent'})).toHaveAttribute('placeholder','Stopping…');
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message to agent'})).toBeEnabled(),{timeout:2000});
  expect(screen.getByRole('button',{name:'Open afbin'})).toHaveTextContent('Ready');
  fireEvent.input(screen.getByRole('textbox',{name:'Message to agent'}),{target:{value:'next request'}});
  fireEvent.submit(screen.getByRole('textbox',{name:'Message to agent'}).closest('form')!);
  await waitFor(()=>expect(inputCount).toBe(1));
});
