/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import { existingPaste } from '@/lib/serving/agent-copy';
import { copyText } from '../lib/copy-text';
import { DocumentAction } from '../document/DocumentBarActions';

/** A token-free handoff for this artifact, kept in the app chrome rather than its content. */
export function CopyAgentButton(props: { id: string; template?: string | null }): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'copied' | 'error'>('idle');
  return <span class="relative">
    <DocumentAction label="Copy for agent" description={state() === 'copied' ? 'Copied — paste into your agent' : 'Copy instructions to edit this artifact with your agent'} onClick={() => void copyText(existingPaste(window.location.origin, props.id, props.template)).then(ok => setState(ok ? 'copied' : 'error'))}>
      <Show when={state() === 'copied'} fallback={<Copy size={16} />}><Check size={16} /></Show><span class="hidden sm:inline">{state() === 'copied' ? 'Copied' : 'Copy for agent'}</span>
    </DocumentAction>
    <Show when={state() === 'error'}><span role="alert" class="absolute right-0 top-full z-50 w-64 rounded border border-edge bg-surface p-3 text-xs">Could not copy. Try again with clipboard access enabled.</span></Show>
  </span>;
}
