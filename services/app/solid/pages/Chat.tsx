import { Portal } from 'solid-js/web';
import { DialogShell } from '../components/DialogShell';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import './chat.css';
import { Plus } from 'lucide-solid';
import TerminalIcon from 'lucide-solid/icons/terminal';
import Cloud from 'lucide-solid/icons/cloud';
import Monitor from 'lucide-solid/icons/monitor';
import X from 'lucide-solid/icons/x';
/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type {RunnerCapabilities} from '@artifactbin/contracts';
import type { RemoteSessionInfo, RemoteView } from '../../../contracts/src/remote';
import { newAgentName, agentNameColor } from '../lib/agent-identity';
import { REMOTE_NAME } from '../../../contracts/src/remote';
import { connectedAgentStatus, isConnectedAgent } from '../lib/connected-agents';
import { Tooltip } from '../components/Tooltip';
import { Button } from '../components/ui';
import { usePageData } from '../lib/use-page-data';
import { copyText } from '../lib/copy-text';
import { startManagedRun } from '../lib/managed-run-retry';

class RemoteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function connectionMessage(error: unknown) {
  if (error instanceof RemoteRequestError && (error.status === 401 || error.status === 403)) return 'Sign in to reconnect to your sessions.';
  if (error instanceof RemoteRequestError && error.status === 410) return 'This remote session was disconnected.';
  return 'Reconnecting… Retrying automatically.';
}

async function request<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/remote/sessions${path}`, {
    method, credentials: 'same-origin',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RemoteRequestError(data?.error ?? 'Remote session unavailable', response.status);
  if (!data) throw new Error('Invalid relay response');
  return data;
}

function SessionTerminal(props: { id: string; onClose: () => void; onSession: (session: RemoteSessionInfo | null) => void }): JSX.Element {
  let container!: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fit: FitAddon | null = null;
  let current: RemoteSessionInfo | null = null;
  let latest: RemoteSessionInfo | null = null;
  let stopRequested = false;
  let queue = Promise.resolve();
  const [info, setInfo] = createSignal<RemoteSessionInfo | null>(null);
  const [error, setError] = createSignal('');
  const [connection, setConnection] = createSignal('Connecting…');
  const [draft, setDraft] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [acting, setActing] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  // A pending Stop is one effective session state, including while older polls arrive.
  const publishSession = (session: RemoteSessionInfo) => {
    latest = session;
    if (session.exitCode != null || session.activity === 'stopped') stopRequested = false;
    current = stopRequested ? { ...session, activity: 'stopping' } : session;
    setInfo(current); props.onSession(current);
  };
  const send = (body: unknown) => {
    const task = queue.then(() => { if (canType()) return request(`/${props.id}`, body); }).then(() => { setError(''); });
    queue = task.catch((reason) => { setError(`Could not confirm the action was delivered. Check the terminal before trying again. ${reason.message}`); });
    return task;
  };

  // Each keyed SessionTerminal owns one xterm instance, cursor and ordered send queue.
  createEffect(() => {
    const t = new Terminal({ cursorBlink: true, convertEol: false, scrollback: 1000, fontSize: 13, theme: { background: '#111214', foreground: '#e6e6e6' } });
    const f = new FitAddon();
    t.loadAddon(f); t.open(container); terminal = t; fit = f;
    const abort = new AbortController();
    let failures = 0, generation: string | undefined, stopped = false, timer: ReturnType<typeof setTimeout>, cursor = -1;
    const poll = async () => {
      try {
        let view = await request<RemoteView>(`/${props.id}?since=${cursor}`, undefined, 'GET', abort.signal);
        if (stopped) return;
        if (generation && view.generation !== generation && view.snapshot === undefined) {
          view = await request<RemoteView>(`/${props.id}?since=-1`, undefined, 'GET', abort.signal);
          if (stopped) return;
        }
        generation = view.generation;
        publishSession(view.session);
        if (view.snapshot !== undefined) {
          t.resize(view.session.cols, view.session.rows); t.reset();
          if (view.snapshot) await new Promise<void>((resolve) => t.write(view.snapshot!, resolve));
        }
        for (const frame of view.frames) {
          if (stopped) return;
          t.resize(frame.cols, frame.rows);
          if (frame.data) await new Promise<void>((resolve) => t.write(frame.data, resolve));
        }
        if (stopped) return;
        cursor = view.seq; failures = 0;
        setConnection('');
      } catch (reason) {
        if (!stopped) {
          failures++; props.onSession(stopRequested ? current : null);
          if (reason instanceof RemoteRequestError && reason.status === 404) cursor = -1;
          setConnection(connectionMessage(reason));
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), failures ? Math.min(10000, 500 * 2 ** Math.min(failures - 1, 5)) : 250);
    };
    const data = t.onData((value) => { if (canType()) void send({ type: 'input', data: value }).catch(() => {}); });
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent) => { touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined; };
    const touchMove = (event: TouchEvent) => {
      if (touchY === undefined || event.touches.length !== 1) return;
      const viewport = container.parentElement;
      if (viewport && viewport.scrollHeight > viewport.clientHeight + 1) return;
      const y = event.touches[0].clientY;
      const lines = Math.trunc((touchY - y) / 16);
      if (lines) { t.scrollLines(lines); touchY -= lines * 16; }
      event.preventDefault(); event.stopPropagation();
    };
    container.addEventListener('touchstart', touchStart, { passive: true });
    container.addEventListener('touchmove', touchMove, { passive: false, capture: true });
    const observer = new ResizeObserver(() => {
      if (current?.controller === 'web' && !current.runId) {
        const size = f.proposeDimensions();
        if (size && (size.cols !== t.cols || size.rows !== t.rows)) void send({ type: 'control', controller: 'web', cols: Math.max(2, Math.min(300, size.cols)), rows: Math.max(2, Math.min(120, size.rows)) }).catch(() => {});
      }
    });
    observer.observe(container); void poll();
    onCleanup(() => {
      stopped = true; abort.abort(); clearTimeout(timer); observer.disconnect(); data.dispose();
      container.removeEventListener('touchstart', touchStart); container.removeEventListener('touchmove', touchMove, true);
      t.dispose(); terminal = null; fit = null; current = null;
    });
  });

  const switchView = () => {
    const previous = mobile(); setResizing(true); setMobile(!previous);
    if(current?.runId){setResizing(false);return;}
    requestAnimationFrame(() => {
      const size = fit?.proposeDimensions();
      if (!size) { setMobile(previous); setResizing(false); setError('Could not measure the terminal. Try switching views again.'); return; }
      void send({ type: 'control', controller: 'web', cols: Math.max(2, Math.min(300, size.cols)), rows: Math.max(2, Math.min(120, size.rows)) })
        .catch(() => setMobile(previous)).finally(() => setResizing(false));
    });
  };
  const online = () => info()?.online ?? false;
  const canType = () => online() && !connection() && !['queued', 'stopping', 'stopped'].includes(info()?.activity ?? '') && info()?.exitCode == null;
  const waiting = () => {
    const session = info();
    if (!session || session.exitCode != null) return '';
    if (session.activity === 'queued') return 'Waiting for compute capacity. Your agent will start automatically when a slot is available.';
    if (session.online) return '';
    if (!session.runId) return 'Reconnecting… Waiting for your local terminal.';
    if (session.activity === 'starting') return 'Starting your hosted box…';
    if (session.activity === 'stopping') return 'Stopping your hosted box…';
    if (session.activity === 'stopped') return 'This run has ended. Start the same box name to restore your home files.';
    return 'Waiting for your hosted terminal…';
  };
  const ended = () => info()?.exitCode !== null && info()?.exitCode !== undefined;
  // Hosted lifetime is independent of terminal connectivity: missing history must still let
  // the owner cancel the live run. Local managed agents keep their online-only stop contract.
  const canStop = () => !!info()?.managed && !ended() && (info()?.runId ? info()?.activity !== 'stopped' : online());
  const actionLabel = () => ended() ? 'Remove session' : info()?.managed ? (canStop() ? 'Stop agent' : 'Remove agent') : 'Disconnect remote session';
  const removeOrStop = () => {
    if (acting()) return;
    const stopping = canStop();
    setActing(true);
    if (stopping && latest) { stopRequested = true; publishSession(latest); }
    void request(`/${props.id}`, stopping ? { type: 'stop' } : undefined, stopping ? 'POST' : 'DELETE')
      .then(() => { if (!stopping) props.onClose(); })
      .catch((reason) => {
        if (stopping && latest) { stopRequested = false; publishSession(latest); }
        setError(reason.message);
      }).finally(() => setActing(false));
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!canType() || !draft().trim() || sending()) return;
    setSending(true);
    void send({ type: 'input', data: draft().replace(/[\r\n]/g, ' ') + '\r' })
      .then(() => setDraft('')).catch(() => {}).finally(() => setSending(false));
  };

  return <section class="agent-workspace" aria-label="Selected agent">
    <div class="agent-toolbar">
      <div class="mr-auto"><h2 class="agent-title"><Show when={agentNameColor(info()?.name ?? '')}>{color => <span class="agent-color-swatch" aria-hidden="true" style={{'background-color':color()}} />}</Show>{info()?.name ?? 'Connecting…'}</h2>
        <p class="agent-metadata"><span class={`agent-dot ${online() ? 'is-online' : ''}`} aria-hidden="true" />{connection() || (info() ? connectedAgentStatus(info()!) : 'Connecting…')}<span aria-hidden="true"> · </span>{info()?.harness} · {info()?.included ? 'Included cloud agent' : info()?.runId ? 'Cloud box' : info()?.machine}</p></div>
      <Show when={!ended()}><button aria-label={mobile() ? 'Switch to desktop' : 'Switch to mobile'} disabled={!online() || resizing()} class="rounded border border-edge px-3 py-2 disabled:opacity-40" onClick={switchView}>{mobile() ? 'Switch to desktop' : 'Switch to mobile'}</button></Show>
      <button aria-label={actionLabel()} disabled={!info() || acting() || (canStop() && info()?.activity === 'stopping')} class="rounded border border-edge px-3 py-2 disabled:opacity-40" onClick={removeOrStop}>{acting() ? (canStop() ? 'Stopping…' : 'Removing…') : canStop() && info()?.activity === 'stopping' ? 'Stopping…' : actionLabel()}</button>
    </div>
    <Show when={info()?.included}><p class="agent-included-note">Your included {info()?.harness === 'pi' ? 'Pi' : info()?.harness} agent · A personal, durable cloud session. Mention @{info()?.name} in an artifact comment to work with it.</p></Show>
    <details class="agent-help" hidden={!info()?.runId}><summary>Hosted connection details</summary><Show when={info()?.runId}><p class="mb-3 text-xs text-muted">Hosted terminals use a fixed 100 × 30 size; narrow views scroll horizontally.</p><p class="mb-3 text-xs text-muted">Sign in from this terminal: Claude Code uses <code>/login</code>; Codex offers Sign in with Device Code; Pi uses <code>/login</code> for supported providers; OpenCode uses <code>/connect</code>.</p><p class="mb-3 text-xs text-muted">Each agent keeps one conversation across your artifacts. Mention this agent in a comment to queue work. Comments wait until login and startup are complete.</p></Show>
    <Show when={info()?.sshCommand}><CopyCommand label="SSH into this box" command={info()!.sshCommand!} /></Show>
    <Show when={info()?.sshHostKey}><CopyCommand label="SSH known_hosts entry" command={info()!.sshHostKey!} /><p class="mb-3 text-xs text-muted">Add this entry to your SSH known_hosts file to verify this box before connecting.</p></Show></details>
    <Show when={connection() || waiting()}><p role="status" class="mb-2 text-sm text-muted">{connection() || waiting()}</p></Show>
    <Show when={error()}><p role="alert" class="mb-2 text-sm text-red-500">{error()}</p></Show>
    <div class="agent-console" style={{ 'max-width': mobile() ? '420px' : undefined }}>
      <Show when={ended()}><p role="status" class="mb-3 rounded border border-edge bg-surface p-4 text-sm">Session ended (exit {info()?.exitCode}). {info()?.runId
        ? 'Choose Provision cloud agent, then Start hosted box with the same name to open a new terminal. Your home files are retained.'
        : 'Start a new session with afbin remote to reconnect.'}</p></Show>
      <div class="agent-terminal-frame" hidden={ended()}><div ref={container} aria-label="Remote terminal" class="agent-terminal" /></div>
      <div class="agent-scroll-controls" aria-label="Terminal scroll controls" hidden={ended()}>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollPages(-1)}>Scroll up</button>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollPages(1)}>Scroll down</button>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollToBottom()}>Latest output</button>
      </div>
      <Show when={!ended()}><form class="agent-composer" onSubmit={submit}>
        <input aria-label="Message to agent" disabled={!canType() || sending()} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} class="min-w-0 flex-1 rounded border border-edge bg-surface p-3" placeholder={canType() ? 'Message your agent…' : info()?.activity === 'queued' ? 'Waiting for capacity…' : 'Session offline'} maxLength={16000} />
        <button aria-label="Send message" disabled={!canType() || sending() || !draft().trim()} class="rounded bg-accent px-4 text-bg disabled:opacity-40">Send</button>
      </form></Show>
      <Show when={!ended()}><div class="agent-key-controls"><span class="agent-key-label">Send key</span><For each={([['Enter', '\r'], ['Escape', '\x1b'], ['Tab', '\t'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['Ctrl+C', '\x03']] as const)}>{([name, data]) => <button aria-label={`Send ${name}`} disabled={!canType()} class="rounded border border-edge px-3 py-2 text-xs disabled:opacity-40" onClick={() => void send({ type: 'input', data }).catch(() => {})}>{name}</button>}</For></div></Show>
      <details class="agent-help" hidden={ended()}><summary>Terminal controls & session details</summary><p class="mt-3 text-xs text-muted">Swipe up or down in the terminal to scroll its history, or use the scroll buttons. Full-screen agents may manage their own history. Type directly in the terminal or use the message box. The selected terminal size stays in effect until you switch views. {info()?.runId ? (canStop() ? 'Stop agent ends this run. The same agent keeps its login, files and conversation across artifacts and restarts.' : 'This terminal belongs to a hosted run. Home files are retained when the run ends; removing the entry does not erase them.') : info()?.managed ? (canStop() ? 'Stop agent ends this background process.' : 'Remove agent removes remote access and prevents this session from reconnecting. The local process may still be running.') : 'Disconnect removes remote access; your local process keeps running.'}</p></details>
    </div>
  </section>;
}

function CopyCommand(props: { label: string; command: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal('');
  createEffect(() => { if (!copied()) return; const timer = setTimeout(() => setCopied(false), 2000); onCleanup(() => clearTimeout(timer)); });
  return <div><p class="mb-2 text-sm font-medium">{props.label}</p><div class="flex items-start gap-2 rounded border border-edge bg-surface p-3">
    <code class="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">{props.command}</code>
    <Tooltip content={copied() ? 'Copied' : `Copy ${props.label.toLowerCase()}`}><Button type="button" aria-label={`Copy ${props.label.toLowerCase()}`} class="shrink-0" onClick={async () => {
      if (await copyText(props.command)) { setCopied(true); setError(''); }
      else setError('Could not copy. Select and copy the command above.');
    }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><Show when={copied()} fallback={<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></>}><path d="m5 12 4 4L19 6" /></Show></svg></Button></Tooltip>
  </div><span class="sr-only" role="status">{copied() ? 'Copied to clipboard' : ''}</span><Show when={error()}><p role="alert" class="mt-1 text-xs text-muted">{error()}</p></Show></div>;
}

function AgentNameField(props: { value: string; onInput: (value: string) => void; disabled?: boolean }): JSX.Element {
  return <label class="block text-sm">Agent name<div class="agent-name-field"><Show when={agentNameColor(props.value)}>{color => <span class="agent-color-swatch" role="img" aria-label={`Agent color ${color()}`} style={{'background-color':color()}} />}</Show><input aria-label="Agent name" disabled={props.disabled} value={props.value} onInput={event => props.onInput(event.currentTarget.value)} pattern={REMOTE_NAME.source} maxLength={32} required aria-invalid={!REMOTE_NAME.test(props.value)} class="min-w-0 flex-1 bg-transparent p-2" /></div></label>;
}

function ConnectInstructions(): JSX.Element {
  const [harness, setHarness] = createSignal('claude');
  const [name, setName] = createSignal(newAgentName());
  const origin = window.location.origin;
  return <div class="space-y-3">
    <h2 class="font-semibold">Connect your agent</h2><p class="text-xs text-muted">Run this command in your terminal with afbin and your agent already installed.</p>
    <AgentNameField value={name()} onInput={setName} />
    <div class="agent-harness-choices" role="group" aria-label="Choose your agent"><For each={([['claude', 'Claude Code'], ['codex', 'Codex'], ['pi', 'Pi'], ['opencode', 'OpenCode']] as const)}>{([value, label]) => <button type="button" aria-pressed={harness() === value} onClick={() => setHarness(value)}>{label}</button>}</For></div>
    <Show when={REMOTE_NAME.test(name())} fallback={<p role="alert" class="text-xs text-muted">Use 1–32 lowercase letters, digits, hyphens or underscores, starting with a letter.</p>}><CopyCommand label="Run in your terminal" command={`afbin remote --server '${origin}' --name ${name()} ${harness()}`} /></Show>
    <p class="text-xs text-muted">Once connected, your agent appears here. Mention it with @ in artifact comments.</p>
  </div>;
}

function ManagedRunSetup(props:{onCreated:(session:RemoteSessionInfo)=>void}):JSX.Element {
  const [name,setName]=createSignal(newAgentName()),[command,setCommand]=createSignal('claude'),[key,setKey]=createSignal('');
  const [busy,setBusy]=createSignal(false),[error,setError]=createSignal(''),[progress,setProgress]=createSignal('');
  let activeController:AbortController|undefined;let disposed=false;
  onCleanup(()=>{disposed=true;activeController?.abort();});
  const stopWaiting=()=>{activeController?.abort(new DOMException('Stopped waiting','AbortError'));setError('Stopped waiting. Your hosted box may still be stopping. Check your sessions before starting again.');};
  const start=async(event:SubmitEvent)=>{
    event.preventDefault();if(busy())return;setBusy(true);setError('');setProgress('');const controller=new AbortController();activeController=controller;
    try {
      const body=JSON.stringify({requestId:crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),name:name(),command:[command()],...(key().trim()?{sshPublicKey:key().trim()}:{}),compute:{vcpu:1,memoryMiB:2048,ttlSeconds:3600}});
      const result=await startManagedRun({body,signal:controller.signal,onPending:(elapsed)=>{if(!disposed)setProgress(elapsed>=30_000?'The previous hosted box is still stopping. This can take several minutes; you can keep waiting or check your sessions.':'Finishing the previous hosted box…');}});
      props.onCreated(result.session);
    }catch(reason){if(!disposed&&!(reason instanceof DOMException&&reason.name==='AbortError'))setError(reason instanceof Error?reason.message:'Could not start your agent');}finally{if(activeController===controller)activeController=undefined;if(!disposed){setBusy(false);setProgress('');}}
  };
  return <form class="mb-5 space-y-3 rounded border border-edge p-3" onSubmit={start}>
    <h2 class="font-semibold">Start a hosted box</h2><p class="text-xs text-muted">Run a shell or agent on a hosted machine. Sign in to Claude or Codex after the terminal opens.</p>
    <AgentNameField value={name()} onInput={setName} disabled={busy()} />
    <div><p class="mb-2 text-sm">Program</p><div class="agent-harness-choices" role="group" aria-label="Hosted program"><For each={([['bash', 'Shell'], ['claude', 'Claude Code'], ['codex', 'Codex']] as const)}>{([value, label]) => <button type="button" disabled={busy()} aria-pressed={command() === value} onClick={() => setCommand(value)}>{label}</button>}</For></div></div>
    <label class="block text-sm">SSH public key (optional)<textarea aria-label="SSH public key" disabled={busy()} class="mt-1 w-full rounded border border-edge bg-surface p-2" value={key()} onInput={e=>setKey(e.currentTarget.value)} placeholder="ssh-ed25519 …" /></label>
    <p class="text-xs text-muted">1 vCPU · 2 GiB RAM · up to 1 hour. Sign in to your agent in the terminal. Your home files are retained for the same agent name.</p>
    <button class="rounded bg-accent px-3 py-2 text-bg disabled:opacity-40" disabled={busy()}>{busy()?'Starting…':'Start hosted box'}</button>
    <Show when={busy()}><button type="button" class="rounded border border-edge px-3 py-2" onClick={stopWaiting}>Stop waiting</button></Show>
    <Show when={progress()}><p role="status" class="text-sm">{progress()}</p></Show>
    <Show when={error()}><p role="alert" class="text-sm text-red-500">{error()}</p></Show>
  </form>;
}

export function ChatPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const id = () => typeof params.session === 'string' ? params.session : null;
  const [managed,setManaged]=createSignal(false);
  const capabilitiesAbort=new AbortController();
  void fetch('/api/run-capabilities',{credentials:'same-origin',signal:capabilitiesAbort.signal}).then(async response=>{if(response.ok){const value=await response.json() as RunnerCapabilities;setManaged(value.version===1&&value.managedProcesses);}}).catch(()=>{});
  onCleanup(()=>capabilitiesAbort.abort());
  const [setupExpanded, setSetupExpanded] = createSignal(false);
  const [setupMode, setSetupMode] = createSignal<'local' | 'cloud'>('local');
  const setupButton = (mode: 'local' | 'cloud') => <button type="button" class="agent-connect-button" disabled={mode === 'cloud' && !managed()} aria-expanded={setupExpanded() && setupMode() === mode} aria-haspopup="dialog" aria-controls="agent-setup" onClick={() => {setSetupMode(mode);setSetupExpanded(true);}}>{mode === 'local' ? <Plus size={14} /> : <Cloud size={14} />}{mode === 'local' ? 'Connect your agent' : 'Provision cloud agent'}</button>;
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  const page = usePageData<{ sessions: RemoteSessionInfo[] }>('/api/remote/sessions', { loader: (signal) => request('', undefined, 'GET', signal) });
  const sessions = () => page.data()?.sessions ?? [];
  const previousCount = () => sessions().filter((session) => !session.included && !isConnectedAgent(session)).length;
  const visibleSessions = () => sessions().filter((session) => session.included || isConnectedAgent(session) || historyExpanded() || session.id === id());
  createEffect(() => {
    if (id()) return;
    const first = sessions().find(session => session.included) ?? sessions().find(isConnectedAgent);
    if (first) setParams({session:first.id}, {replace:true});
  });
  const groups = [
    {kind:'local' as const, label:'Local agents', empty:'No connected local agents', get sessions() { return visibleSessions().filter(session => !session.included && !session.runId); }},
    {kind:'cloud' as const, label:'Cloud agents', empty:'No cloud agents yet', get sessions() { return visibleSessions().filter(session => session.included || session.runId); }},
  ];
  const error = () => page.error() ? connectionMessage(page.error()) : '';
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  let failures = 0;
  const poll = async () => {
    await page.refresh();
    failures = page.error() ? failures + 1 : 0;
    if (!stopped) timer = setTimeout(() => void poll(), failures ? Math.min(10000, 3000 * 2 ** Math.min(failures - 1, 2)) : 3000);
  };
  void poll();
  onCleanup(() => { stopped = true; clearTimeout(timer); });
  const close = () => { const closed = id(); setParams({}); page.seed({ sessions: sessions().filter((session) => session.id !== closed) }); };
  return <main class="workspace-page agents-page" aria-label="Connected Agents">
    <Show when={setupExpanded()}><Portal mount={trustedPortalOf(document) ?? document.body}><DialogShell onClose={() => setSetupExpanded(false)} lockScroll initialFocus={setupMode() === 'local' ? '[aria-pressed="true"]' : 'input'}>
      <div class="agent-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setSetupExpanded(false); }}>
      <section id="agent-setup" class="agent-setup" role="dialog" aria-modal="true" aria-label={setupMode() === 'local' ? 'Connect your agent' : 'Provision cloud agent'}>
      <button class="agent-setup-close" type="button" aria-label="Close agent setup" onClick={() => setSetupExpanded(false)}><X size={16} /></button>
      <Show when={setupMode() === 'local'} fallback={<ManagedRunSetup onCreated={session=>{page.seed({sessions:[...sessions().filter(s=>s.id!==session.id),session]});setParams({session:session.id});setSetupExpanded(false);}} />}><ConnectInstructions /></Show>
    </section></div></DialogShell></Portal></Show>
    <Show when={error()}><p role="alert" class="mb-4 text-sm">{error()} <Show when={error().startsWith('Sign in')}><a href={`/login?callbackUrl=${encodeURIComponent(`/chat${id() ? `?session=${id()}` : ''}`)}`} class="underline">Sign in</a></Show></p></Show>
    <div class="agents-layout"><aside class="agent-sidebar" aria-label="Agents">
      <div class="agent-list-heading"><h2>Agents</h2><span>{sessions().filter(isConnectedAgent).length} connected</span></div>
      <For each={groups}>{group => <section class="agent-session-group" data-agent-location={group.kind} aria-label={group.label}><h3>{group.kind === 'local' ? <Monitor size={12} aria-hidden="true" /> : <Cloud size={12} aria-hidden="true" />}{group.label}</h3><div class="agent-group-action">{setupButton(group.kind)}</div><Show when={!group.sessions.length}><p class="agent-group-empty">{group.empty}</p></Show>
      <For each={group.sessions}>{(session) => <button aria-label={`Open ${session.name}`} aria-pressed={session.id === id()} class={`agent-session ${session.id === id() ? 'is-selected' : ''}`} onClick={() => setParams({ session: session.id })}><span class="agent-session-name"><Show when={agentNameColor(session.name)}>{color => <span class="agent-color-swatch" aria-hidden="true" style={{'background-color':color()}} />}</Show><span class="truncate">{session.name}</span><Show when={session.included}><span class="agent-included-tag">Included for free</span></Show><span class={`agent-dot ${isConnectedAgent(session) ? 'is-online' : ''}`} aria-hidden="true" /></span><span class="text-xs text-muted">{session.harness} · {connectedAgentStatus(session)}</span></button>}</For>
      </section>}</For>
      <Show when={previousCount() > 0}><button type="button" aria-expanded={historyExpanded()} class="agent-history-toggle" onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded() ? 'Hide' : 'Show'} previous sessions ({previousCount()})</button></Show>

      <p class="agent-sidebar-note">Mention an online agent with <strong>@</strong> in any artifact comment.</p>
    </aside><Show when={id()} keyed fallback={<div class="agent-empty" role="region" aria-label="No agent selected"><TerminalIcon size={32} stroke-width={1.3} /><h2>{visibleSessions().length ? 'Choose an agent' : 'Your next session starts here'}</h2><p>{visibleSessions().length ? 'Select a session to view its terminal and send a message.' : 'Connect an agent to work on your artifacts and follow its progress here.'}</p><div class="agent-empty-actions">{setupButton('local')}{setupButton('cloud')}</div></div>}>{(sessionId) => <SessionTerminal id={sessionId} onClose={close} onSession={setSelectedSession} />}</Show></div>
  </main>;
}
