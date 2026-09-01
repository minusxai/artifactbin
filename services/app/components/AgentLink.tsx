'use client';

/**
 * The get-started strip. One click mints a real, empty document and hands over
 * the instruction to paste into an agent — then opens that document, so the
 * page in front of the user is the one the agent is about to write.
 *
 * The document is created on CLICK, never on page view: creating one per
 * visitor would burn the anonymous-mint rate limit on people who are only
 * reading. Until then this is just a button.
 */
import { Check, Copy, Loader2 } from 'lucide-react';
import { useRouter } from '@/lib/navigation';
import { useState } from 'react';
import CopyBlock from '@/components/CopyBlock';
import { Tooltip } from '@/components/Tooltip';
import { LINK } from '@/components/ui';

interface StartResponse {
  id: string;
  url: string;
  prompt?: string;
  error?: string;
}

export default function AgentLink({
  docsLink = true,
  frame = true,
  reveal = false,
  size = 'panel',
}: {
  docsLink?: boolean;
  /**
   * HOW BIG THE BUTTON IS, and nothing else. `panel` fills the getting-started
   * card, which is the page's primary action; `inline` matches the footer's
   * own row of small controls, where the same act is offered again to a reader
   * who has finished reading. The BEHAVIOUR is deliberately not a prop — the
   * two surfaces mint the same way, or they will drift into meaning different
   * things.
   */
  size?: 'panel' | 'inline';
  /** false = just the button and its status line, for hosts with their own chrome. */
  frame?: boolean;
  /**
   * SHOW THE INSTRUCTION RATHER THAN ONLY COPYING IT.
   *
   * A button that silently fills the clipboard and navigates away asks for
   * trust it has not earned — the reader never sees what they just put in
   * their paste buffer, and one of the two shapes carries a TOKEN. With this
   * on, the real text is shown after the click and the page does NOT navigate
   * away from what it just revealed. A redacted PREVIEW before the click was
   * tried and removed: it cost four lines of the panel to show a sentence
   * with its two interesting parts blanked out.
   */
  reveal?: boolean;
  /** The idle status line; a host can prefix its own context onto it. */
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [docUrl, setDocUrl] = useState('');

  const start = async () => {
    if (state === 'working') return;
    setState('working');
    try {
      // The cookie rides along, so the server can attribute the new document
      // to this browser (and skip the stranger rate limit) — the document
      // still gets its own fresh token, appended to the cookie's list.
      const res = await fetch('/api/start', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as StartResponse;
      if (!res.ok) {
        setState('error');
        setMessage(body.error === 'rate_limited' ? 'too many new documents from here — try again shortly' : 'could not start a document');
        return;
      }
      // The server decides the paste from the caller's session state; this
      // client only copies that decision and keeps no second wording rule.
      setDocUrl(`/a/${body.id}`);
      if (typeof body.prompt === 'string') setPrompt(body.prompt);
      try {
        if (typeof body.prompt !== 'string') throw new Error('start response did not include an agent paste');
        await navigator.clipboard.writeText(body.prompt);
        setMessage('copied! now paste it to your agent');
      } catch {
        setMessage('created! copy the prompt from the document page');
      }
      setState('done');
      // Land on the live document — after a beat. Navigating the same tick
      // swallows the "copied" feedback, and a copy nobody saw happen might as
      // well not have happened. When the instruction is REVEALED there is
      // something on screen worth staying for, so the reader leaves by
      // choosing to.
      if (!reveal) setTimeout(() => router.push(`/a/${body.id}`), 1200);
    } catch {
      setState('error');
      setMessage('could not reach the server');
    }
  };

  const body = (
    <>
      {/* THE primary action of the page, so it wears the kit's one solid
        * accent — everything else in the panel is quiet text on dark, and a
        * reader scanning for "what do I do first" lands here. In the done
        * state the button itself says what just happened; the tooltip alone
        * was invisible feedback. */}
      <Tooltip content={state === 'done' ? 'copied!' : 'creates a live doc'}>
        <button
          onClick={() => void start()}
          disabled={state === 'working'}
          aria-label="Create a live document for my agent"
          className={`flex cursor-pointer items-center justify-center rounded-[4px] border border-accent bg-accent font-semibold text-bg transition-all hover:brightness-110 disabled:opacity-60 ${
            size === 'inline'
              ? 'gap-1.5 px-2.5 py-1.5 font-mono text-[11.5px]'
              : 'mt-2 w-full gap-2 px-2.5 py-2 font-mono text-xs'
          }`}
        >
          <span className="min-w-0 break-words">
            {state === 'working'
              ? 'creating your document…'
              : state === 'done'
                ? message
                : 'copy agent instructions'}
          </span>
          {state === 'working' ? (
            <Loader2 size={13} className="shrink-0 animate-spin" />
          ) : state === 'done' ? (
            <Check size={13} className="shrink-0" />
          ) : (
            <Copy size={13} className="shrink-0" />
          )}
        </button>
      </Tooltip>
      {state === 'error' && (
        <p role="alert" className="mt-1.5 font-mono text-[11px] text-danger">
          {message}
        </p>
      )}
      {reveal && state === 'done' && prompt && (
        <div className="mt-2">
          <CopyBlock className="mt-0" text={prompt} label="Copy the agent instruction again" />
          <p className="mt-1.5 font-mono text-[11px] text-muted">
            <a href={docUrl} className={LINK}>
              open your document →
            </a>{' '}
            empty until your agent writes to it
          </p>
        </div>
      )}
    </>
  );

  if (!frame) return <div>{body}</div>;
  return (
    <div className="rounded-[6px] border border-edge bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-fg">Start a live document:</span>
        {docsLink && (
          <a href="/docs" className={`shrink-0 font-mono text-xs ${LINK}`}>
            how it works →
          </a>
        )}
      </div>
      {body}
    </div>
  );
}
