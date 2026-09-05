'use client';

import { GitHubIcon } from '@/components/brand-icons';
import { FORMAT_COLORS, formatLabel, LINK, PAGE_COLUMN } from '@/components/ui';
import { Tooltip } from '@/components/Tooltip';
import { REPO_URL } from '@/lib/repo';

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
  username,
  stats,
}: {
  email?: string | null;
  /**
   * The account's public handle. THE identity line when there is one: every
   * document this account owns lives under `/@handle` and the profile is the
   * page that lists them, so the masthead points there rather than printing an
   * address nobody can click. Absent — an account whose lazy backfill has not
   * run yet (lib/users ensureUsername) — and the header is what it always was.
   */
  username?: string | null;
  stats?: HeaderStats | null;
}) {
  const formats = Object.entries(stats?.formats ?? {}).filter(([, n]) => n > 0);
  return (
    <div className={PAGE_COLUMN}>
      <header /* The top band exists only to clear the FLOATING corner controls, which
             * are fixed 12px from each edge and 36px tall. They collide with the
             * masthead only while the reading column is wide enough to reach the
             * gutters — past ~1080px the centred column starts well inside them,
             * and the band is 56px of nothing. So it is reserved by WIDTH rather
             * than always. */
            className="flex items-center justify-between gap-4 border-b border-edge pt-14 pb-3 sm:gap-6 sm:pb-4 min-[1080px]:pt-5">
        <a href="/" aria-label="artifactbin home" className="flex shrink-0 items-center gap-2.5 text-fg no-underline sm:gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="" className="h-8 w-8 sm:h-20 sm:w-20" />
          <span className="flex flex-col gap-0.5">
            <span className="text-base leading-none font-semibold tracking-tight whitespace-nowrap sm:text-xl">artifactbin</span>
            <span className="hidden font-mono text-[11px] whitespace-nowrap text-muted sm:block">Google Docs for agents</span>
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
            {username ? (
              /* The EMAIL rides in the tooltip rather than on a line of its
                 own: this column is already four rows deep on a phone, and
                 "which account is this" is asked once a session where "take me
                 to my profile" is a thing to click. */
              <Tooltip content={email ?? 'your profile'}>
                <a href={`/@${username}`} aria-label="Open your profile" className={`min-w-0 truncate ${LINK}`}>
                  @{username}
                </a>
              </Tooltip>
            ) : email ? (
              <span className="min-w-0 truncate text-faint">{email}</span>
            ) : (
              /* Not aria-label "Login"/"Log in": the sidebar owns the
               * first and the login form's submit button owns the second
               * (gate-app-flows counts both). */
              <a href="/login" aria-label="Log in from header" className={LINK}>
                log in
              </a>
            )}
            {/* The masthead is where a visitor looks for "is this a real,
              * inspectable thing" — so the source sits with the sign-in door
              * rather than being a footer link they have to scroll for. */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="artifactbin on GitHub"
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${LINK}`}
            >
              <GitHubIcon size={12} /> open source
            </a>
            <span className="shrink-0 whitespace-nowrap text-muted">
              <a href="/docs/artifactbin/SKILL.md" className={LINK}>
                agent docs
              </a>
              {' / '}
              <a href="/docs-human" className={LINK}>
                human docs
              </a>
            </span>
          </span>
        </div>
      </header>
    </div>
  );
}
