'use client';

/**
 * A command or URL the reader is meant to take with them: mono block, one
 * copy button. Wraps rather than scrolls — in a narrow panel a command that
 * runs off the edge is a command the reader never sees. Shared by the
 * get-started cards and the pro-tip deck, so the two can't drift apart in
 * chrome.
 */
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Tooltip } from '@/components/Tooltip';

export default function CopyBlock({
  text,
  label,
  trailer,
  className = 'mt-3',
}: {
  text: string;
  label: string;
  /** A dimmed display-only line under the text — shown, never copied. */
  trailer?: string;
  /** Placement belongs to the host; ordinary copy blocks keep their top gap. */
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied — the text is right there to select */
    }
  };
  return (
    <div className={`${className} flex items-start gap-2 rounded-[4px] border border-edge-bright bg-bg px-2.5 py-2`}>
      {/* Plain ink, not accent: a command is something to read, and green is
        * reserved for the thing to DO first (the panel's one solid button). */}
      <pre className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-fg">
{text}
        {trailer && <span className="text-muted">{'\n'}{trailer}</span>}
      </pre>
      <Tooltip content={copied ? 'copied!' : 'copy'}>
        <button
          onClick={() => void copy()}
          aria-label={label}
          className="mt-[2px] shrink-0 cursor-pointer text-muted hover:text-fg"
        >
          {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
        </button>
      </Tooltip>
    </div>
  );
}
