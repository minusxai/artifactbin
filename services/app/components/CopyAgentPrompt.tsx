'use client';

/**
 * The top-level document action that puts the "hand this document to an agent"
 * instruction on the clipboard — one paste line carrying a one-time START LINK
 * (never a token), for a document that already exists.
 *  - session owners: POST /api/my/artifacts/<id>/agent-prompt parks a fresh
 *    user-owned token (account-wide scope reaches a doc ANY of their tokens
 *    made) in a start handle and returns the finished prompt;
 *  - anonymous (token) owners: the server answers 409 — an anonymous token
 *    reaches only what it created and the original plaintext exists nowhere —
 *    so the button says "sign in" instead.
 */
import {appFetch as fetch} from '@/web/api-origin';
import { Bot, Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';

export default function CopyAgentPrompt({ id, variant = 'chip' }: {
  id: string;
  /** `menu` renders as a full-width document-control row. */
  variant?: 'chip' | 'menu';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error' | 'signin'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    let prompt: string | null = null;
    try {
      // Always issued server-side: the browser holds no plaintext token, and
      // the paste itself carries only a one-time start link the agent claims.
      const res = await fetch(`/api/my/artifacts/${id}/agent-prompt`, { method: 'POST' });
      // An anonymous owner has no account for a new token to belong to, and an
      // anonymous token reaches only what it created — so the server says so
      // instead of minting one that cannot edit this document.
      if (res.status === 409) {
        setState('signin');
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setState('idle'), 4000);
        return;
      }
      if (res.ok) prompt = ((await res.json()) as { prompt: string }).prompt;
      if (!prompt) {
        setState('error');
        return;
      }
      await navigator.clipboard.writeText(prompt);
      setState('copied');
    } catch {
      setState('error');
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState('idle'), 2000);
  };

  const label = state === 'copied' ? 'copied'
    : state === 'signin' ? 'sign in required'
    : state === 'error' ? 'try again'
    : 'copy for agent';

  if (variant === 'menu') {
    return (
      <button
        type="button"
        aria-label="Copy agent instructions"
        aria-live="polite"
        onClick={() => void copy()}
        className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        {state === 'copied' ? <Check size={14} className="shrink-0 text-accent" /> : <Bot size={14} className="shrink-0" />}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <Tooltip
      content={
        state === 'copied' ? 'copied — paste it to any agent'
        : state === 'signin' ? 'sign in to hand this document to another agent'
        : state === 'error' ? 'could not copy'
        : 'copy instructions for another agent'
      }
    >
      <button
        type="button"
        aria-label="Copy agent instructions"
        aria-live="polite"
        onClick={() => void copy()}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-edge bg-raised px-2 py-1 text-muted hover:border-edge-bright hover:text-accent"
      >
        {state === 'copied' ? <Check size={12} className="shrink-0 text-accent" /> : <Bot size={12} className="shrink-0" />}
        <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      </button>
    </Tooltip>
  );
}
