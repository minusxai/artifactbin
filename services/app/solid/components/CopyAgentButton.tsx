/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import { existingPaste } from '@/lib/agent-copy/agent-copy';
import { copyText } from '../lib/copy-text';
import { Button } from '../ui/Button';
import { LAYER } from '../ui/layers';
import { StatusMessage } from '../ui/StatusMessage';
import { Tooltip } from '../ui/Tooltip';

/** A token-free handoff for this artifact, kept in the app chrome rather than its content. */
export function CopyAgentButton(props: { id: string; template?: string | null }): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const description = () => state() === 'copied' ? 'Copied — paste into your agent' : 'Copy for agent';
  return <span class="relative">
    <Tooltip content={description()}><Button type="button" variant="secondary" size="sm" aria-label="Copy for agent" aria-description={description()}
      onClick={() => void copyText(existingPaste(window.location.origin, props.id, props.template)).then(ok => setState(ok ? 'copied' : 'error'))}>
      <Show when={state() === 'copied'} fallback={<Copy size={14} />}><Check size={14} /></Show>
      <span>{state() === 'copied' ? 'Copied' : 'Copy for agent'}</span>
    </Button></Tooltip>
    <Show when={state() === 'error'}><span class="absolute left-0 top-full w-64" style={{ 'z-index': LAYER.popover }}><StatusMessage kind="error" class="text-xs">Could not copy. Try again with clipboard access enabled.</StatusMessage></span></Show>
  </span>;
}
