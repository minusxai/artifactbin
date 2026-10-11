/* @jsxImportSource solid-js */
/**
 * The app's ONE 404. The login href is a signal set on mount and re-read on click.
 */
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { FORM_PRIMARY_BUTTON, FORM_SECONDARY_BUTTON } from '../ui/FormControls';
import { loginHref } from '@/lib/http/login-href';
import { useSession } from '../lib/session';
import { useChromeVisibility } from '../components/PageChrome';

export function NotFoundPage(): JSX.Element {
  const { session } = useSession();
  const setChromeVisible = useChromeVisibility();
  const [href, setHref] = createSignal('/login');
  onMount(() => { setHref(loginHref(window.location)); setChromeVisible?.(false); });
  onCleanup(() => setChromeVisible?.(true));
  return (
    <main aria-label="Not found" class="mx-auto mt-16 max-w-2xl px-6 pb-24 text-center">
      <p class="font-sans text-[clamp(5rem,18vw,9rem)] leading-none font-semibold tracking-tight text-accent">404</p>
      <p class="mt-8 text-xl font-semibold text-fg">
        Nothing readable lives at this address.
      </p>
      <p class="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted">
        The artifact may have been deleted or the link mistyped — or it exists
        and you don&rsquo;t have access. A missing document and a private one
        look identical from outside, and we won&rsquo;t say which this is. Hmph.
      </p>
      <p class="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
        <a href="/" rel="external" aria-label="Back to artifacts" class={FORM_PRIMARY_BUTTON}>← back to your artifacts</a>
        <Show when={!session()?.user}>
          <a href={href()} rel="external" onClick={(event) => { event.currentTarget.href = loginHref(window.location); }} aria-label="Sign in"
            class={FORM_SECONDARY_BUTTON}>
            sign in — if it&rsquo;s yours to see
          </a>
        </Show>
      </p>
    </main>
  );
}
