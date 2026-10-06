/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import { existingPaste } from '@/lib/serving/agent-copy';
import { copyText } from '../lib/copy-text';
import { Tooltip } from './Tooltip';

/** A token-free handoff for this artifact, kept in the app chrome rather than its content. */
export function CopyAgentButton(props: { id: string; template?: string | null }): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const description = () => state() === 'copied' ? 'Copied — paste into your agent' : 'Copy for agent';
  return <span class="relative">
    <Tooltip content={description()}><button type="button" aria-label="Copy for agent" aria-description={description()}
      class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[4px] border border-edge bg-surface text-muted hover:border-edge-bright hover:text-fg"
      onClick={() => void copyText(existingPaste(window.location.origin, props.id, props.template)).then(ok => setState(ok ? 'copied' : 'error'))}>
      <Show when={state() === 'copied'} fallback={<Copy size={13} />}><Check size={13} /></Show>
    </button></Tooltip>
    <Show when={state() === 'error'}><span role="alert" class="absolute left-0 top-full z-50 w-64 rounded border border-edge bg-surface p-3 text-xs">Could not copy. Try again with clipboard access enabled.</span></Show>
  </span>;
}
