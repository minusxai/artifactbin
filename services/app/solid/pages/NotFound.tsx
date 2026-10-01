/* @jsxImportSource solid-js */
/**
 * The app's ONE 404 (web/pages/NotFound.tsx) in Solid: same copy, same accessible names. The
 * React page's `useLoginHref` hook becomes a signal set on mount and re-read on click.
 */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { LINK } from '../components/ui';
import { loginHref } from '@/lib/http/login-href';
import { useSession } from '../lib/session';
import { useChromeVisibility } from '../components/PageChrome';

const GLITCH_CSS = `
.nf-glitch { animation: nf-glitch 2.6s steps(1) infinite; }
@keyframes nf-glitch {
  0% { text-shadow: 0.06em 0 var(--color-danger), -0.06em 0 var(--color-accent); transform: translateX(-0.015em); }
  3% { text-shadow: -0.06em 0 var(--color-danger), 0.06em 0 var(--color-accent); transform: translateX(0.015em) skewX(-2deg); }
  6% { text-shadow: 0.035em 0 var(--color-accent); transform: none; }
  9%, 55% { text-shadow: none; transform: none; }
  58% { text-shadow: -0.04em 0 var(--color-accent), 0.04em 0 var(--color-danger); transform: translateX(0.01em); }
  61%, 100% { text-shadow: none; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .nf-glitch { animation: none; } }
`;

export function NotFoundPage(): JSX.Element {
  const { session } = useSession();
  const setChromeVisible = useChromeVisibility();
  const [href, setHref] = createSignal('/login');
  onMount(() => { setHref(loginHref(window.location)); setChromeVisible?.(false); });
  onCleanup(() => setChromeVisible?.(true));
  return (
    <main aria-label="Not found" class="mx-auto mt-16 max-w-4xl px-6 pb-24 justify-center text-center">
      <style>{GLITCH_CSS}</style>
      <p class="nf-glitch font-mono text-[clamp(9rem,28vw,19rem)] leading-none font-semibold tracking-tight text-fg">404</p>
      <p class="reveal mt-8 font-mono text-base text-fg" style={{ 'animation-delay': '80ms' }}>
        Nothing readable lives at this address.
      </p>
      <p class="reveal mx-auto mt-2 max-w-xl font-mono text-sm leading-relaxed text-muted text-justify" style={{ 'animation-delay': '140ms' }}>
        The artifact may have been deleted or the link mistyped — or it exists
        and you don&rsquo;t have access. A missing document and a private one
        look identical from outside, and we won&rsquo;t say which this is. Hmph.
      </p>
      <p class="reveal mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-sm" style={{ 'animation-delay': '220ms' }}>
        <a href="/" rel="external" aria-label="Back to artifacts" class={LINK}>← back to your artifacts</a>
        <Show when={!session()?.user}>
          <a href={href()} rel="external" onClick={(event) => { event.currentTarget.href = loginHref(window.location); }} aria-label="Sign in"
            class="text-muted no-underline underline-offset-4 hover:text-fg hover:underline">
            sign in — if it&rsquo;s yours to see
          </a>
        </Show>
      </p>
    </main>
  );
}
