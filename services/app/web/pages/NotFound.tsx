/**
 * The app's ONE 404 — the glitch page that was `app/not-found.tsx` before the
 * SPA split, restored: the split left three misses with three faces (this
 * page's plainer successor, a bare "not found" line inside the artifact and
 * profile pages, and Hono's text default on root typos). Every miss renders
 * THIS component now — the SPA's catch-all route, ArtifactPage and
 * ProfilePage on a data miss, and the server serves the SPA with the 404
 * STATUS so a curl and a crawler read the same verdict a person sees.
 *
 * It catches "gone" and "not yours to read" alike — the ACL answers a uniform
 * 404 for both on purpose (existence must not leak), so the copy is honest
 * about the ambiguity and offers sign-in as the way out of it for a stranger.
 * Someone signed in has already used that door. It paints nothing of
 * its own: the palette lives in globals.css, so the dot-grid ground shows
 * through.
 */
import { LINK } from '@/components/ui';
import { useSession } from '../session';

export function NotFoundPage() {
  const { session } = useSession();
  return (
    <main aria-label="Not found" className="mx-auto mt-16 max-w-4xl px-6 pb-24 justify-center text-center">
      <style>{`
        /* The RGB-split twitch fires at the top of the loop (so it plays the
         * moment the page paints), stutters twice, then rests — and takes a
         * smaller second jolt mid-loop so the page never feels parked. */
        .nf-glitch { animation: nf-glitch 2.6s steps(1) infinite; }
        @keyframes nf-glitch {
          0% { text-shadow: 0.06em 0 var(--color-danger), -0.06em 0 var(--color-accent); transform: translateX(-0.015em); }
          3% { text-shadow: -0.06em 0 var(--color-danger), 0.06em 0 var(--color-accent); transform: translateX(0.015em) skewX(-2deg); }
          6% { text-shadow: 0.035em 0 var(--color-accent); transform: none; }
          9%, 55% { text-shadow: none; transform: none; }
          58% { text-shadow: -0.04em 0 var(--color-accent), 0.04em 0 var(--color-danger); transform: translateX(0.01em); }
          61%, 100% { text-shadow: none; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .nf-glitch { animation: none; }
        }
      `}</style>

      {/* The number IS the graphic. */}
      <p className="nf-glitch font-mono text-[clamp(9rem,28vw,19rem)] leading-none font-semibold tracking-tight text-fg">
        404
      </p>

      <p className="reveal mt-8 font-mono text-base text-fg" style={{ animationDelay: '80ms' }}>
        Nothing readable lives at this address.
      </p>
      <p className="reveal mx-auto mt-2 max-w-xl font-mono text-sm leading-relaxed text-muted text-justify" style={{ animationDelay: '140ms' }}>
        The artifact may have been deleted or the link mistyped — or it exists
        and you don&rsquo;t have access. A missing document and a private one
        look identical from outside, and we won&rsquo;t say which this is. Hmph.
      </p>

      <p className="reveal mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-sm" style={{ animationDelay: '220ms' }}>
        <a href="/" aria-label="Back to artifacts" className={LINK}>
          ← back to your artifacts
        </a>
        {!session?.user && (
          <a href="/login" aria-label="Sign in" className="text-muted no-underline underline-offset-4 hover:text-fg hover:underline">
            sign in — if it&rsquo;s yours to see
          </a>
        )}
      </p>
    </main>
  );
}
