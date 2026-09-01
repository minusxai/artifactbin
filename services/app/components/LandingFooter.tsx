/**
 * ONE FOOTER FOR EVERY LANDING DESIGN. The designs are under review and will
 * be thrown away; the links a front door owes a visitor — the company behind
 * it, what it does with their data, and the source — are not, and must not be
 * three copies that fall out of step while the layouts churn.
 *
 * TWO LINES AND A MARK. It was briefly a tall band of headed link columns over
 * a rule over the wordmark, which is the shape a company with five products
 * needs; this one has seven links, and three of them were sitting alone under a
 * heading. Collapsed to a single wrapped row, the whole footer costs about a
 * third of the height and reads faster, because seven links in a line are seven
 * links rather than three lists to parse first.
 *
 * THE WORDMARK IS SET IN THE MONO, deliberately, while the landing's headlines
 * are now a Garamond. The serif speaks where the page makes a claim in its own
 * words; the name of the thing is the terminal's own voice, and it keeps the
 * identity anchored where the display face cannot follow.
 */
import AgentLink from '@/components/AgentLink';
import { GitHubIcon } from '@/components/brand-icons';
import { LINK, PAGE_COLUMN } from '@/components/ui';
import { REPO_URL } from '@/lib/repo';

const MINUSX_URL = 'https://minusx.ai';
/**
 * PLACEHOLDER — deliberately an address we own rather than a third party's
 * booking page, so a visitor who clicks it lands on this product and not on
 * somebody else's calendar by accident. Swap it for the real booking link.
 */
const DEMO_URL = '/demo';

/** One row, in the order a stranger needs them. */
const LINKS: readonly { label: string; href: string; external?: true }[] = [
  { label: 'how it works', href: '/docs/human' },
  { label: 'agent docs', href: '/docs/artifact-bin/SKILL.md' },
  { label: 'github', href: REPO_URL, external: true },
  { label: 'privacy', href: '/privacy' },
  { label: 'terms', href: '/terms' },
  { label: 'minusx', href: MINUSX_URL, external: true },
];

export default function LandingFooter({ column = PAGE_COLUMN }: { column?: string }) {
  return (
    <footer className={`${column} mt-14 sm:mt-20`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-edge pb-4">
        {/*
          * THE LINKS GROW BUT NEVER SHRINK — `grow shrink-0 basis-64`.
          *
          * The nav has to yield width so the two actions can sit to its right
          * rather than on a line of their own; `flex-1 min-w-0` does that and
          * is wrong, because a flex item that may shrink to nothing WILL:
          * measured on a 390px phone, the nav took the 38px the buttons left
          * it and stacked all six links in a one-word column beside them.
          * A floor of 16rem instead means the row runs out of space before the
          * nav does, so the buttons wrap under it on a phone — the honest
          * mobile layout — and on the desktop column the nav grows to fill
          * whatever is left of the row.
          */}
        <nav
          aria-label="About artifactbin"
          className="flex shrink-0 grow basis-64 flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11.5px]"
        >
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className={`inline-flex items-center gap-1.5 ${LINK}`}
            >
              {link.label === 'github' && <GitHubIcon size={12} />}
              {link.label}
            </a>
          ))}
        </nav>

        {/* The two things to actually DO, kept together so neither reads as
          * another reference link. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={DEMO_URL}
            className="rounded-[4px] border border-edge-bright px-2.5 py-1.5 font-mono text-[11.5px] text-fg no-underline transition-colors hover:border-accent hover:text-accent"
          >
            book a demo
          </a>
          {/* THE SAME BUTTON AS THE TOP OF THE PAGE, not a link back to it: a
            * reader who got this far and decided should not be sent to the top
            * to find the real control. One AgentLink, two sizes. */}
          <AgentLink frame={false} docsLink={false} size="inline" />
        </div>
      </div>

      {/* The mark and its colophon on ONE baseline — the wordmark's own line box
        * is cropped tight (leading 0.8) because at this size the font's default
        * leading is most of the space the footer was spending.
        *
        * THE LOCKUP IS THE HEADER'S, ENLARGED: the logo leads and the name
        * follows, the same order the top bar uses, so the two read as one
        * identity rather than as two treatments of it. It replaced a green
        * block caret — the get-started prompt's own mark, which was a nice
        * terminal joke but put a made-up glyph where the product already has a
        * real one. Sized in `em` so it tracks the wordmark through the clamp
        * instead of needing its own breakpoints. */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-1">
        <span
          aria-hidden
          className="flex select-none items-center gap-[0.13em] font-mono text-[clamp(1.7rem,7.2vw,4rem)] leading-[0.8] font-bold tracking-[-0.055em] text-fg"
        >
          <img
            src="/logo-256.png"
            alt=""
            width={256}
            height={256}
            className="h-[0.92em] w-[0.92em] shrink-0 -translate-y-[0.04em]"
          />
          artifactbin
        </span>
        <span className="font-mono text-[10.5px] whitespace-nowrap text-faint">
          open source · Apache-2.0
        </span>
      </div>
    </footer>
  );
}
