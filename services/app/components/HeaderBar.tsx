'use client';

import { FORMAT_COLORS, formatLabel, LINK, PAGE_COLUMN } from '@/components/ui';

export interface HeaderStats {
  /** Count per normalized format, insertion order = display order. */
  formats: Record<string, number>;
  total: number;
}

/**
 * THE READOUT IS A LEGEND, NOT COLOURED TEXT.
 *
 * The counts used to be printed IN their format's hue, which is how the badge
 * below them works and is wrong at this size: mx-markup's hue is pomegranate,
 * so the largest number on the page was a line of red text, and red text in a
 * status line reads as a fault rather than as a category. The hue moves to a
 * dot — the same signal, carried by a mark that has no other meaning — and the
 * words stay legible ink. The dots also do the separating, which is what the
 * interpuncts were for; on a phone those were hidden and the line ran on.
 */
function FormatDot({ format, count }: { format: string; count: number }) {
  return (
    /* Desktop detail: on a phone the legend wrapped into a ragged second
       line, and "21 artifacts" already answers the phone's question. */
    <span aria-label={`${count} ${formatLabel(format)}`} className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap sm:flex">
      <span
        data-format-dot=""
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: FORMAT_COLORS[format] ?? '#95a5a6' }}
      />
      <span className="text-fg">{count}</span>
      <span className="text-muted">{formatLabel(format)}</span>
    </span>
  );
}

/**
 * The masthead: brand lockup left, terminal status readout right. The readout
 * is the header's content — live account facts fill the band instead of dead
 * space. Rendered only inside the shell route group, so /a/* never sees it —
 * the artifact page owns its whole surface. The open band above the lockup is
 * where page-level controls sit without becoming a bar.
 *
 * ON A PHONE it is the SAME masthead scaled, not a second layout: brand
 * lockup left, right-aligned readout column beside it, exactly as on desktop.
 * What shrinks is the lockup — the 80px mark cost a third of the screen
 * before a single document appeared, and the page menu already carries the
 * brand — and the tagline goes with it: for a signed-in phone it is marketing
 * copy spending a line, and beside a small mark it read as one run-on line.
 * The readout wraps right-aligned into the column the small mark frees up.
 */
export default function HeaderBar({
  email,
  stats,
}: {
  email?: string | null;
  stats?: HeaderStats | null;
}) {
  const formats = Object.entries(stats?.formats ?? {}).filter(([, n]) => n > 0);
  return (
    <div className={PAGE_COLUMN}>
      <header className="flex items-center justify-between gap-4 border-b border-edge pt-16 pb-3 sm:gap-6 sm:pb-5">
        <a href="/" aria-label="artifact-bin home" className="flex shrink-0 items-center gap-2.5 text-fg no-underline sm:gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="" className="h-8 w-8 sm:h-20 sm:w-20" />
          <span className="flex flex-col gap-0.5">
            <span className="text-base leading-none font-semibold tracking-tight whitespace-nowrap sm:text-xl">artifact-bin</span>
            <span className="hidden font-mono text-[11px] whitespace-nowrap text-muted sm:block">pastebin for agents</span>
          </span>
        </a>
        <div className="flex min-w-0 flex-col items-end gap-1 text-right font-mono text-[11px] leading-4">
          {stats && (
            <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {/* The total leads, in ink: one thing for the eye to land on
                  before the breakdown, which is otherwise a row of equals. */}
              <span aria-label={`${stats.total} artifacts`} className="shrink-0 whitespace-nowrap">
                <span className="font-semibold text-fg">{stats.total}</span>
                <span className="ml-1 text-muted">artifact{stats.total === 1 ? '' : 's'}</span>
              </span>
              {formats.length > 0 && (
                <span aria-hidden="true" className="hidden h-3 w-px shrink-0 bg-edge sm:block" />
              )}
              {formats.map(([format, n]) => (
                <FormatDot key={format} format={format} count={n} />
              ))}
            </span>
          )}
          <span className="flex min-w-0 flex-col items-end gap-1">
            {email ? (
              <span className="min-w-0 truncate text-faint">{email}</span>
            ) : (
              /* Not aria-label "Log in page"/"Log in": the sidebar owns the
               * first and the login form's submit button owns the second
               * (gate-app-flows counts both). */
              <a href="/login" aria-label="Log in from header" className={LINK}>
                log in
              </a>
            )}
            <span className="shrink-0 whitespace-nowrap text-muted">
              <a href="/docs/artifact-bin/SKILL.md" className={LINK}>
                agent docs
              </a>
              {' / '}
              <a href="/docs/human" className={LINK}>
                human docs
              </a>
            </span>
          </span>
        </div>
      </header>
    </div>
  );
}
