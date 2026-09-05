'use client';

import { GitHubIcon } from '@/components/brand-icons';
import { LINK, PAGE_COLUMN } from '@/components/ui';
import { REPO_URL } from '@/lib/repo';

/**
 * The masthead: brand lockup left, durable navigation right. Artifact counts,
 * format totals and the signed-in address live on the working surfaces where
 * they are useful; repeating them here made the chrome compete with the page.
 * Rendered only inside the shell route group, so /a/* never sees it — the
 * artifact page owns its whole surface.
 *
 * ON A PHONE it is the SAME masthead scaled, not a second layout: brand
 * lockup left, right-aligned utility column beside it, exactly as on desktop.
 * What shrinks is the lockup — the 80px mark cost a third of the screen
 * before a single document appeared, and the page menu already carries the
 * brand — and the tagline goes with it: for a signed-in phone it is marketing
 * copy spending a line, and beside a small mark it read as one run-on line.
 * The utility links stay right-aligned in the space the small mark frees up.
 */
export default function HeaderBar({ authed = false }: { authed?: boolean }) {
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
        <nav aria-label="Site links" className="flex min-w-0 flex-col items-end gap-1 text-right font-mono text-[11px] leading-4">
          {!authed && (
            /* Not aria-label "Login"/"Log in": the sidebar owns the
             * first and the login form's submit button owns the second
             * (gate-app-flows counts both). */
            <a href="/login" aria-label="Log in from header" className={LINK}>log in</a>
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
        </nav>
      </header>
    </div>
  );
}
