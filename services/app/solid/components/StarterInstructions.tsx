/* @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import { existingPaste } from '@/lib/serving/agent-copy';
import { copyText } from '../lib/copy-text';

/**
 * First-party starter chrome. The paste is public, tokenless
 * text; copying it must not require an owner session or imply permission to edit the document.
 */
export function StarterInstructions(props: { id: string; template?: string | null; onContinueBlank?: () => void; converting?: boolean; conversionError?: string }): JSX.Element {
  let instructions!: HTMLTextAreaElement;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const [draft, setDraft] = createSignal<string | null>(null);
  const [state, setState] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const prompt = () => draft() ?? existingPaste(origin, props.id, props.template);
  const copy = async () => {
    setState(await copyText(prompt()) ? 'copied' : 'error');
  };
  onMount(() => {
    const frame = requestAnimationFrame(() => instructions.focus({ preventScroll: true }));
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return <section aria-label="Agent instructions" class="mx-auto flex min-h-[75svh] w-full max-w-2xl flex-col justify-center gap-5 px-6 py-20 text-fg">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Your artifact is ready for your agent!</h1>
      <p class="mt-2 text-sm text-muted">Copy this into your coding agent and tell it what to build.</p>
    </div>
    <textarea aria-label="Agent instructions" ref={instructions} rows={10} spellcheck={false} value={prompt()}
      onInput={(event) => { setDraft(event.currentTarget.value); setState('idle'); }}
      class="w-full resize-y rounded-md border border-edge bg-raised p-4 font-mono text-xs leading-relaxed text-muted focus:border-accent focus:outline-none" />
    <button type="button" aria-label="Copy agent instructions" disabled={!origin} onClick={() => void copy()} class="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
      <Show when={state() === 'copied'} fallback={<Copy size={18} aria-hidden="true" />}><Check size={18} aria-hidden="true" /></Show>
      {state() === 'copied' ? 'Copied — paste into your agent' : 'Copy agent instructions'}
    </button>
    <Show when={props.onContinueBlank}>
      <button type="button" disabled={props.converting} onClick={() => props.onContinueBlank?.()} class="min-h-12 w-full cursor-pointer rounded-md border border-edge bg-raised px-5 py-3 text-sm font-semibold disabled:opacity-50">{props.converting ? 'Opening blank report…' : 'Continue with blank report'}</button>
    </Show>
    <Show when={props.conversionError}><p role="alert" class="text-sm text-muted">{props.conversionError}</p></Show>
    <p role="status" class="text-center font-mono text-xs text-muted">{state() === 'error' ? 'Could not copy. Select and copy the instructions above.' : 'Waiting for your agent…'}</p>
  </section>;
}
