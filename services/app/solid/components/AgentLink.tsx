/* @jsxImportSource solid-js */
import type { ArtifactDestination } from '@artifactbin/contracts';
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Check, Copy, Loader2 } from 'lucide-solid';
import { Tooltip } from '../ui/Tooltip';
import { LINK } from '../ui/ui';
import { copyText } from '../lib/copy-text';

interface StartResponse { id: string; url: string; prompt?: string; error?: string }
const COUNTDOWN_S = 3;
export function AgentLink(props: { docsLink?: boolean; frame?: boolean; size?: 'panel' | 'inline'; destination?: ArtifactDestination }): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = createSignal('');
  const [countdown, setCountdown] = createSignal<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  onCleanup(() => { if (timer) clearInterval(timer); });
  const start = async () => {
    if (state() === 'working' || state() === 'done') return;
    setState('working');
    try {
      const response = await fetch('/api/start', { method: 'POST', ...(props.destination ? {headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:props.destination})} : {}) });
      const body = await response.json().catch(() => ({})) as StartResponse;
      if (!response.ok) { setState('error'); setMessage(body.error === 'rate_limited' ? 'too many new documents from here — try again shortly' : 'could not start a document'); return; }
      setMessage(typeof body.prompt === 'string' && await copyText(body.prompt) ? 'copied! paste it in the agent' : 'created! copy the prompt from the document page');
      setState('done'); setCountdown(COUNTDOWN_S);
      let left = COUNTDOWN_S;
      timer = setInterval(() => { left--; if (left > 0) { setCountdown(left); return; } if (timer) clearInterval(timer); timer = null; window.location.assign(`/a/${body.id}`); }, 1000);
    } catch { setState('error'); setMessage('could not reach the server'); }
  };
  const label = () => state() === 'working' ? 'creating your document…' : state() === 'done' ? message() : 'copy agent instructions';
  const body = <><Tooltip content={state() === 'done' ? 'copied!' : 'creates a live doc'}><button type="button" onClick={() => void start()} disabled={state() === 'working'} aria-label="Create a live document for my agent" class={`flex cursor-pointer items-center rounded-[4px] border border-accent bg-accent font-semibold text-bg transition-all hover:brightness-110 disabled:opacity-60 ${countdown() === null ? 'justify-center' : 'justify-between'} ${(props.size ?? 'panel') === 'inline' ? 'gap-1.5 px-2.5 py-1.5 font-mono text-[11.5px]' : 'w-full gap-2 px-3 py-2.5 font-mono text-[12.5px]'}`}><span class="flex min-w-0 items-center gap-2"><span class="min-w-0 break-words">{label()}</span><Show when={state() === 'working'} fallback={<Show when={state() === 'done'} fallback={<Copy size={13} />}><Check size={13} /></Show>}><Loader2 size={13} class="animate-spin" /></Show></span><Show when={countdown() !== null}><span class="shrink-0 font-normal tabular-nums opacity-75">going to the artifact in {countdown()}…</span></Show></button></Tooltip><Show when={state() === 'error'}><p role="alert" class="mt-1.5 font-mono text-[11px] text-danger">{message()}</p></Show></>;
  return <Show when={props.frame !== false} fallback={<div>{body}</div>}><div class="rounded-[6px] border border-edge bg-surface px-4 py-3"><div class="flex items-baseline justify-between gap-3"><span class="font-mono text-xs text-fg">Start a live document:</span><Show when={props.docsLink !== false}><a href="/docs-human" class={`shrink-0 font-mono text-xs ${LINK}`}>how it works →</a></Show></div><div class="mt-2">{body}</div></div></Show>;
}
