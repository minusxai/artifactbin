/* @jsxImportSource solid-js */
import { createSignal, onMount, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import { existingPaste } from '@/lib/agent-copy/agent-copy';
import { ARTIFACT_STARTERS } from '@/lib/workspace/artifact-starters';
import { copyText } from '../lib/copy-text';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Field';

/**
 * First-party starter chrome. The paste is public, tokenless
 * text; copying it must not require an owner session or imply permission to edit the document.
 * `page` is the agent handoff's own page (solid/pages/Starter), waiting for the agent; `dialog` is the same paste inside
 * a document's "hand to an agent" dialog (solid/document/AgentHandoffDialog), whose title says what it is.
 */
export function StarterInstructions(props: { id: string; template?: string | null; variant?: 'page' | 'dialog'; onContinueBlank?: () => void; converting?: boolean; conversionError?: string }): JSX.Element {
  let instructions!: HTMLTextAreaElement;
  const fitInstructions = () => {
    instructions.style.height = 'auto';
    instructions.style.height = `${instructions.scrollHeight + 2}px`;
  };
  onMount(fitInstructions);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const typeName = () => ARTIFACT_STARTERS.find(starter => starter.template === props.template)?.label.toLowerCase() ?? 'artifact';
  const [draft, setDraft] = createSignal<string | null>(null);
  const [state, setState] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const prompt = () => draft() ?? existingPaste(origin, props.id, props.template);
  const copy = async () => {
    setState(await copyText(prompt()) ? 'copied' : 'error');
  };
  const page = () => props.variant !== 'dialog';
  return <section aria-label="Agent instructions" class={page() ? 'mx-auto flex min-h-[75svh] w-full max-w-2xl flex-col justify-center gap-5 px-6 py-20 text-fg' : 'flex w-full flex-col gap-5 text-fg'}>
    <div>
      <Show when={page()}><h1 class="text-2xl font-semibold tracking-tight">Your {typeName()} is ready for your agent!</h1></Show>
      <p class={page() ? 'mt-2 text-sm text-muted' : 'text-sm text-muted'}>{page() ? 'Copy this into your coding agent and tell it what to build.' : `Copy this into your coding agent and tell it what to do with this ${typeName()}.`}</p>
    </div>
    <Textarea ref={instructions} size="sm" aria-label="Agent instructions" rows={8} spellcheck={false} value={prompt()}
      onInput={(event) => { setDraft(event.currentTarget.value); setState('idle'); fitInstructions(); }}
      class="resize-y" />
    <p class="-mt-2 font-sans text-xs text-muted">New to artifactbin? <a href={`${origin}/getting-started`} target="_blank" rel="noopener noreferrer" class="underline decoration-edge-bright underline-offset-4 hover:text-fg">Getting started</a></p>
    <Button aria-label="Copy agent instructions" disabled={!origin} onClick={() => void copy()} class="w-full">
      <Show when={state() === 'copied'} fallback={<Copy size={18} aria-hidden="true" />}><Check size={18} aria-hidden="true" /></Show>
      {state() === 'copied' ? 'Copied — paste into your agent' : 'Copy agent instructions'}
    </Button>
    <Show when={props.onContinueBlank}>
      <Button variant="secondary" disabled={props.converting} onClick={() => props.onContinueBlank?.()} class="w-full">{props.converting ? 'Opening blank report…' : 'Continue with blank report'}</Button>
    </Show>
    <Show when={props.conversionError}><p role="alert" class="text-sm text-muted">{props.conversionError}</p></Show>
    <Show when={page() || state() === 'error'}><p role="status" class="text-center text-sm text-muted">{state() === 'error' ? 'Could not copy. Select and copy the instructions above.' : 'Waiting for your agent…'}</p></Show>
  </section>;
}
