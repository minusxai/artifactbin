import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { existingPaste } from '@/lib/agent-copy';
import { clearInitialStory } from '@/web/initial-story';

/** First-party starter chrome. The paste is public, tokenless text; copying it
 * must not require an owner session or imply permission to edit the document. */
export default function StarterInstructions({ id, initialOrigin = '' }: { id: string; initialOrigin?: string }) {
  const instructions = useRef<HTMLTextAreaElement>(null);
  const [origin, setOrigin] = useState(initialOrigin);
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  // Reveal the mounted controls before focusing; the server sibling hides #root.
  useLayoutEffect(() => { clearInitialStory(); }, []);
  // TrustedUi mounts into a shadow portal; wait until it is attached before focusing.
  useEffect(() => {
    const frame = requestAnimationFrame(() => instructions.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const prompt = draft ?? existingPaste(origin, id);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setState('copied'); }
    catch { setState('error'); }
  };
  return <section aria-label="Agent instructions" className="mx-auto flex min-h-[75svh] w-full max-w-2xl flex-col justify-center gap-5 px-6 py-20 text-fg">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Your artifact is ready for your agent!</h1>
      <p className="mt-2 text-sm text-muted">Copy this into your coding agent and tell it what to build.</p>
    </div>
    <textarea
      aria-label="Agent instructions"
      ref={instructions}
      rows={10}
      spellCheck={false}
      value={prompt}
      onChange={event => { setDraft(event.target.value); setState('idle'); }}
      className="w-full resize-y rounded-md border border-edge bg-raised p-4 font-mono text-xs leading-relaxed text-muted focus:border-accent focus:outline-none"
    />
    <button type="button" aria-label="Copy agent instructions" disabled={!origin} onClick={() => void copy()} className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
      {state === 'copied' ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
      {state === 'copied' ? 'Copied — paste into your agent' : 'Copy agent instructions'}
    </button>
    <p role="status" className="text-center font-mono text-xs text-muted">{state === 'error' ? 'Could not copy. Select and copy the instructions above.' : 'Waiting for your agent…'}</p>
  </section>;
}
