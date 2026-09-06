'use client';

/**
 * The get-started strip. One click mints a real, empty document and hands over
 * the instruction to paste into an agent — then opens that document, so the
 * page in front of the user is the one the agent is about to write.
 *
 * ONE BEHAVIOUR, EVERY SURFACE. The landing hero used to opt out of the
 * navigation (a `reveal` prop that showed the instruction and stayed put)
 * while the landing FOOTER, the docs page and the signed-in home all
 * navigated — the same button, drawn three times on two pages, meaning two
 * different things. There is no prop for it now: mint, copy, say so, count
 * the reader down, go. The instruction is on the document page too
 * (`CopyAgentPrompt`), which is where the clipboard-failed wording already
 * sent people, so arriving there loses nothing.
 *
 * THE PAUSE IS NARRATED. A beat before navigating is what makes the "copied"
 * feedback land, but an unexplained one reads as a hang and the move that
 * follows reads as the page going somewhere on its own. Counting it out —
 * beside the message, on the same row — makes it something the reader was
 * told about before it happened.
 *
 * The document is created on CLICK, never on page view: creating one per
 * visitor would burn the anonymous-mint rate limit on people who are only
 * reading. Until then this is just a button.
 */
import {appFetch as fetch} from '@/web/api-origin';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useRouter } from '@/lib/navigation';
import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { LINK } from '@/components/ui';

interface StartResponse {
  id: string;
  url: string;
  prompt?: string;
  error?: string;
}

/** Seconds between the copy landing and the page changing under it. */
const COUNTDOWN_S = 3;

export default function AgentLink({
  docsLink = true,
  frame = true,
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
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The countdown outlives nothing: a reader who navigates away by some other
  // route must not be yanked back by a timer the unmounted button left behind.
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const start = async () => {
    // Idle or a failed attempt may be clicked; a run in flight and a document
    // already counting down may not — a second click on a visible countdown
    // would mint a second document and abandon the first.
    if (state === 'working' || state === 'done') return;
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
      try {
        if (typeof body.prompt !== 'string') throw new Error('start response did not include an agent paste');
        await navigator.clipboard.writeText(body.prompt);
        setMessage('copied! paste it in the agent');
      } catch {
        // The document page carries the prompt too, so this wording and the
        // navigation that follows it agree.
        setMessage('created! copy the prompt from the document page');
      }
      setState('done');
      // Land on the live document — after a narrated beat. Navigating the
      // same tick swallows the "copied" feedback, and a copy nobody saw
      // happen might as well not have happened.
      setCountdown(COUNTDOWN_S);
      let left = COUNTDOWN_S;
      timer.current = setInterval(() => {
        left -= 1;
        if (left > 0) { setCountdown(left); return; }
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        router.push(`/a/${body.id}`);
      }, 1000);
    } catch {
      setState('error');
      setMessage('could not reach the server');
    }
  };

  const label =
    state === 'working' ? 'creating your document…' : state === 'done' ? message : 'copy agent instructions';

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
          className={`flex cursor-pointer items-center rounded-[4px] border border-accent bg-accent font-semibold text-bg transition-all hover:brightness-110 disabled:opacity-60 ${
            countdown === null ? 'justify-center' : 'justify-between'
          } ${
            size === 'inline'
              ? 'gap-1.5 px-2.5 py-1.5 font-mono text-[11.5px]'
              : 'mt-2 w-full gap-2 px-2.5 py-2 font-mono text-xs'
          }`}
        >
          <span className={`flex min-w-0 items-center ${size === 'inline' ? 'gap-1.5' : 'gap-2'}`}>
            <span className="min-w-0 break-words">{label}</span>
            {state === 'working' ? (
              <Loader2 size={13} className="shrink-0 animate-spin" />
            ) : state === 'done' ? (
              <Check size={13} className="shrink-0" />
            ) : (
              <Copy size={13} className="shrink-0" />
            )}
          </span>
          {/* The other half of the row: what is about to happen, and when.
            * `tabular-nums` so the digit changing does not shuffle the words
            * beside it. */}
          {countdown !== null && (
            <span className="shrink-0 font-normal tabular-nums opacity-75">
              going to the artifact in {countdown}…
            </span>
          )}
        </button>
      </Tooltip>
      {state === 'error' && (
        <p role="alert" className="mt-1.5 font-mono text-[11px] text-danger">
          {message}
        </p>
      )}
    </>
  );

  if (!frame) return <div>{body}</div>;
  return (
    <div className="rounded-[6px] border border-edge bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-fg">Start a live document:</span>
        {docsLink && (
          <a href="/docs-human" className={`shrink-0 font-mono text-xs ${LINK}`}>
            how it works →
          </a>
        )}
      </div>
      {body}
    </div>
  );
}
