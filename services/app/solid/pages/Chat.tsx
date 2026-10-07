import WorkspaceHeading from '../components/WorkspaceHeading';
import { afbinInstallCommand, afbinWindowsInstallCommand } from '@/lib/serving/agent-discovery-tags';
/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type {RunnerCapabilities} from '@artifactbin/contracts';
import type { RemoteSessionInfo, RemoteView } from '../../../contracts/src/remote';
import { isConnectedAgent } from '../lib/connected-agents';
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

function SessionTerminal(props: { id: string; onClose: () => void }): JSX.Element {
  let container!: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fit: FitAddon | null = null;
  let current: RemoteSessionInfo | null = null;
  let queue = Promise.resolve();
  const [info, setInfo] = createSignal<RemoteSessionInfo | null>(null);
  const [error, setError] = createSignal('');
  const [connection, setConnection] = createSignal('Connecting…');
  const [draft, setDraft] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [acting, setActing] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const send = (body: unknown) => {
    const task = queue.then(() => request(`/${props.id}`, body)).then(() => { setError(''); });
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
        current = view.session; setInfo(view.session);
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
        setConnection(view.session.online || view.session.exitCode !== null ? '' : view.session.runId ? view.session.activity==='starting'?'Starting your hosted box…':view.session.activity==='stopping'?'Stopping your hosted box…':view.session.activity==='stopped'?'This run has ended. Start the same box name to restore your home files.':'Waiting for your hosted terminal…' : 'Reconnecting… Waiting for your local terminal.');
      } catch (reason) {
        if (!stopped) {
          failures++;
          if (reason instanceof RemoteRequestError && reason.status === 404) cursor = -1;
          setConnection(connectionMessage(reason));
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), failures ? Math.min(10000, 500 * 2 ** Math.min(failures - 1, 5)) : 250);
    };
    const data = t.onData((value) => { if (current?.online) void send({ type: 'input', data: value }).catch(() => {}); });
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
  const canType = () => online() && !connection();
  const ended = () => info()?.exitCode !== null && info()?.exitCode !== undefined;
  // Hosted lifetime is independent of terminal connectivity: missing history must still let
  // the owner cancel the live run. Local managed agents keep their online-only stop contract.
  const canStop = () => !!info()?.managed && !ended() && (info()?.runId ? info()?.activity !== 'stopped' : online());
  const actionLabel = () => ended() ? 'Remove session' : info()?.managed ? (canStop() ? 'Stop agent' : 'Remove agent') : 'Disconnect remote session';
  const removeOrStop = () => {
    setActing(true);
    const stopping = canStop();
    void request(`/${props.id}`, stopping ? { type: 'stop' } : undefined, stopping ? 'POST' : 'DELETE')
      .then(() => { if (!stopping) props.onClose(); else setInfo((previous) => previous ? { ...previous, activity: 'stopping' } : previous); })
      .catch((reason) => setError(reason.message)).finally(() => setActing(false));
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!draft().trim() || sending()) return;
    setSending(true);
    void send({ type: 'input', data: draft().replace(/[\r\n]/g, ' ') + '\r' })
      .then(() => setDraft('')).catch(() => {}).finally(() => setSending(false));
  };

  return <section class="min-w-0 flex-1">
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <div class="mr-auto"><h2 class="font-semibold">{info()?.name ?? 'Connecting…'}</h2>
        <p class="text-xs text-muted">{info()?.harness} · {info()?.machine} · {info()?.activity ? `${info()?.activity} · ` : ''}{' '}{connection() || (online() ? 'Online' : ended() ? `Exited (${info()?.exitCode})` : 'Offline')}</p></div>
      <Show when={!ended()}><button aria-label={mobile() ? 'Switch to desktop' : 'Switch to mobile'} disabled={!online() || resizing()} class="rounded border border-edge px-3 py-2 disabled:opacity-40" onClick={switchView}>{mobile() ? 'Switch to desktop' : 'Switch to mobile'}</button></Show>
      <button aria-label={actionLabel()} disabled={!info() || acting() || (canStop() && info()?.activity === 'stopping')} class="rounded border border-edge px-3 py-2 disabled:opacity-40" onClick={removeOrStop}>{acting() ? (canStop() ? 'Stopping…' : 'Removing…') : canStop() && info()?.activity === 'stopping' ? 'Stopping…' : actionLabel()}</button>
    </div>
    <Show when={info()?.runId}><p class="mb-3 text-xs text-muted">Hosted terminals use a fixed 100 × 30 size; narrow views scroll horizontally.</p><p class="mb-3 text-xs text-muted">For Codex authentication, run <code>codex login --device-auth</code> in a shell, then follow its browser link. For Claude Code, use its <code>/login</code> flow.</p><p class="mb-3 text-xs text-muted">To connect artifact comments, run afbin remote for your installed agent in a separate shell or SSH session.</p></Show>
    <Show when={info()?.sshCommand}><CopyCommand label="SSH into this box" command={info()!.sshCommand!} /></Show>
    <Show when={info()?.sshHostKey}><CopyCommand label="SSH known_hosts entry" command={info()!.sshHostKey!} /><p class="mb-3 text-xs text-muted">Add this entry to your SSH known_hosts file to verify this box before connecting.</p></Show>
    <Show when={connection()}><p role="status" class="mb-2 text-sm text-muted">{connection()}</p></Show>
    <Show when={error()}><p role="alert" class="mb-2 text-sm text-red-500">{error()}</p></Show>
    <div style={{ 'max-width': mobile() ? '420px' : undefined }}>
      <Show when={ended()}><p role="status" class="mb-3 rounded border border-edge bg-surface p-4 text-sm">Session ended (exit {info()?.exitCode}). Start a new session with afbin remote to reconnect.</p></Show>
      <div class="overflow-x-auto rounded border border-edge bg-[#111214] p-2" hidden={ended()}><div ref={container} aria-label="Remote terminal" style={{ height: 'min(58dvh, 650px)', 'min-height': '240px' }} /></div>
      <div class="mt-2 flex flex-wrap gap-2" aria-label="Terminal scroll controls" hidden={ended()}>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollPages(-1)}>Scroll up</button>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollPages(1)}>Scroll down</button>
        <button class="rounded border border-edge px-3 py-2 text-xs" onClick={() => terminal?.scrollToBottom()}>Latest output</button>
      </div>
      <Show when={!ended()}><form class="mt-3 flex gap-2" onSubmit={submit}>
        <input aria-label="Message to agent" disabled={!canType() || sending()} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} class="min-w-0 flex-1 rounded border border-edge bg-surface p-3" placeholder={canType() ? 'Message your agent…' : 'Session offline'} maxLength={16000} />
        <button aria-label="Send message" disabled={!canType() || sending() || !draft().trim()} class="rounded bg-accent px-4 text-bg disabled:opacity-40">Send</button>
      </form></Show>
      <Show when={!ended()}><div class="mt-2 flex flex-wrap gap-2"><For each={([['Enter', '\r'], ['Escape', '\x1b'], ['Tab', '\t'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['Ctrl+C', '\x03']] as const)}>{([name, data]) => <button aria-label={`Send ${name}`} disabled={!canType()} class="rounded border border-edge px-3 py-2 text-xs disabled:opacity-40" onClick={() => void send({ type: 'input', data }).catch(() => {})}>{name}</button>}</For></div></Show>
      <p class="mt-3 text-xs text-muted" hidden={ended()}>Swipe up or down in the terminal to scroll its history, or use the scroll buttons. Full-screen agents may manage their own history. Type directly in the terminal or use the message box. The selected terminal size stays in effect until you switch views. {info()?.runId ? (canStop() ? 'Stop agent ends this run. Your home files are retained for the same box name.' : 'This terminal belongs to a hosted run. Home files are retained when the run ends; removing the entry does not erase them.') : info()?.managed ? (canStop() ? 'Stop agent ends this background process.' : 'Remove agent removes remote access and prevents this session from reconnecting. The local process may still be running.') : 'Disconnect removes remote access; your local process keeps running.'}</p>
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

function InstallInstructions(): JSX.Element {
  const [harness, setHarness] = createSignal('claude');
  const origin = window.location.origin;
  return <div class="mt-4 space-y-4">
    <CopyCommand label="Install CLI" command={afbinInstallCommand(origin)} />
    <p class="text-xs text-muted">macOS / Linux: run both commands in the same terminal. Supported Node/npm is reused; otherwise official Node LTS is installed for your user.</p>
    <CopyCommand label="Install Windows CLI for artifacts" command={afbinWindowsInstallCommand(origin)} />
    <p class="text-xs text-muted">Windows: run both commands in PowerShell; npx.cmd works without changing script execution policy.</p>
    <p class="text-xs text-muted">Use the command below to sign in to this server and start your installed agent.</p>
    <div><label for="remote-harness" class="mb-2 block text-sm">Choose your agent</label><select id="remote-harness" value={harness()} onChange={(event) => setHarness(event.currentTarget.value)} class="w-full rounded border border-edge bg-surface p-2 text-sm"><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="pi">Pi</option><option value="opencode">OpenCode</option></select></div>
    <CopyCommand label="Start a session" command={`afbin remote --server '${origin}' ${harness()}`}  />
    <p class="text-xs text-muted">Your agent must already be installed. Type @ in an artifact comment to mention an online session.</p>
  </div>;
}

function ManagedRunSetup(props:{onCreated:(session:RemoteSessionInfo)=>void}):JSX.Element {
  const [name,setName]=createSignal('my-agent'),[command,setCommand]=createSignal('bash'),[key,setKey]=createSignal('');
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
    <h2 class="font-semibold">Run your agent on a hosted box</h2>
    <label class="block text-sm">Box name<input aria-label="Box name" disabled={busy()} class="mt-1 w-full rounded border border-edge bg-surface p-2" value={name()} onInput={e=>setName(e.currentTarget.value)} pattern="[a-z][a-z0-9_-]{0,31}" required /></label>
    <label class="block text-sm">Program<select aria-label="Hosted program" disabled={busy()} class="mt-1 w-full rounded border border-edge bg-surface p-2" value={command()} onChange={e=>setCommand(e.currentTarget.value)}><option value="bash">Shell</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
    <label class="block text-sm">SSH public key (optional)<textarea aria-label="SSH public key" disabled={busy()} class="mt-1 w-full rounded border border-edge bg-surface p-2" value={key()} onInput={e=>setKey(e.currentTarget.value)} placeholder="ssh-ed25519 …" /></label>
    <p class="text-xs text-muted">1 vCPU · 2 GiB RAM · up to 1 hour. Sign in to your agent in the terminal. Your home files are retained for the same box name.</p>
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
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  const page = usePageData<{ sessions: RemoteSessionInfo[] }>('/api/remote/sessions', { loader: (signal) => request('', undefined, 'GET', signal) });
  const sessions = () => page.data()?.sessions ?? [];
  const previousCount = () => sessions().filter((session) => !isConnectedAgent(session)).length;
  const visibleSessions = () => sessions().filter((session) => isConnectedAgent(session) || historyExpanded() || session.id === id());
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
  return <main class="workspace-page">
    <WorkspaceHeading title="Connected agents" description="Your agents, on your machine or hosted for you." />
    <Show when={error()}><p role="alert" class="mb-4 text-sm">{error()} <Show when={error().startsWith('Sign in')}><a href={`/login?callbackUrl=${encodeURIComponent(`/chat${id() ? `?session=${id()}` : ''}`)}`} class="underline">Sign in</a></Show></p></Show>
    <div class="flex flex-col gap-6 md:flex-row"><aside class="shrink-0 md:w-80">
      <For each={visibleSessions()}>{(session) => <button aria-label={`Open ${session.name}`} aria-pressed={session.id === id()} class={`mb-2 block w-full rounded border p-3 text-left ${session.id === id() ? 'border-accent bg-surface' : 'border-edge'}`} onClick={() => setParams({ session: session.id })}><span class="block truncate">{session.name}</span><span class="text-xs text-muted">{session.harness} · {session.runId ? session.activity==='starting'?'Starting':session.activity==='working'?'Running':session.activity==='stopping'?'Stopping':session.activity==='stopped'?'Ended':session.activity==='unknown'?'Unavailable':'Offline' : session.exitCode !== null && session.exitCode !== undefined ? 'Ended' : session.online ? 'Online' : 'Offline'}</span></button>}</For>
      <Show when={previousCount() > 0}><button type="button" aria-expanded={historyExpanded()} class="mb-4 w-full rounded border border-edge px-3 py-2 text-left text-sm text-muted" onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded() ? 'Hide' : 'Show'} previous sessions ({previousCount()})</button></Show>
      <Show when={id()}><button type="button" aria-expanded={setupExpanded()} aria-controls="cli-setup" class="mt-2 flex w-full items-center justify-between rounded border border-edge px-3 py-2 text-sm md:hidden" onClick={() => setSetupExpanded((value) => !value)}>CLI setup <span aria-hidden="true">{setupExpanded() ? '−' : '+'}</span></button></Show>
      <Show when={managed()}><ManagedRunSetup onCreated={session=>{page.seed({sessions:[...sessions().filter(s=>s.id!==session.id),session]});setParams({session:session.id});}} /></Show>
      <div id="cli-setup" class={id() && !setupExpanded() ? 'hidden md:block' : ''}><InstallInstructions /></div>
    </aside><Show when={id()} keyed fallback={<div class="rounded border border-edge p-8 text-muted">Select a session, or start one from your CLI.</div>}>{(sessionId) => <SessionTerminal id={sessionId} onClose={close} />}</Show></div>
  </main>;
}
