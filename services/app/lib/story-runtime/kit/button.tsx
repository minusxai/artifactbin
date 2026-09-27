/** The `button` kit chunk: `<Button>`, and the one TRIGGER — a click that writes (lib/story/dataflow REF_ATTRS Button.run). */
import { useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/kit/button';
import { refName } from '@/lib/story/dataflow';
import { refusalText } from '@/lib/story/sign-in-required';
import { NO_SUBSCRIBE, RuntimeEmbedContext, useBindingReader } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

/**
 * The LIVE `<Button run="$add" set={{…}} args={{…}}>`: a click first sets
 * the page values `set=` names — all of them in ONE step, no SQL and no
 * server — then performs the named `<Mutation>` with its arguments (`args=`,
 * else the page values of the same names; lib/story-runtime/store mutate), and
 * the queries reading the dataset it wrote re-run on their own — so the click
 * that adds a row is the click that redraws the chart. A button with only
 * `set=` is the page's own state machine: it never writes anything.
 *
 * Three things it owes the reader while that happens: it is `aria-busy` and
 * disabled for the duration (a double click is one write, enforced in the
 * store as well as here), a refusal is SHOWN rather than swallowed — the
 * server's own message, in a role="alert" beside the button, because a button
 * that silently does nothing is the failure this whole path exists to avoid —
 * and the message clears on the next attempt.
 */
function ButtonAdapter(props: Record<string, unknown>) {
  const { store, chrome } = useContext(RuntimeEmbedContext);
  const read = useBindingReader();
  const name = typeof props.run === 'string' ? refName(props.run) : null;
  const [error, setError] = useState<string | null>(null);
  const unavailable = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => name ? store ? store.mutationUnavailable(name) : 'Checking edit access…' : null, () => name ? 'Checking edit access…' : null);
  // Hooks run unconditionally (an unbound Button renders through the same
  // component); the subscription is a no-op when there is no store.
  const busy = useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    () => (store && name ? store.mutating().has(name) : false),
    () => false,
  );
  const { run: _run, set, args, children, ...rest } = props;
  if (!store || (!name && !set)) return <Button {...(rest as Record<string, unknown>)} run={props.run} set={set}>{children as ReactNode}</Button>;
  return (
    <>
      <Button
        {...(rest as Record<string, unknown>)}
        aria-busy={busy || undefined}
        disabled={!chrome || busy || unavailable !== null || rest.disabled === true}
        aria-description={refusalText(unavailable) ?? undefined}
        onClick={() => {
          setError(null);
          const values = read(set);
          if (values) store.setValues(values);
          if (name) store.mutate(name, read(args)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'that did not save'));
        }}
      >
        {children as ReactNode}
      </Button>
      {unavailable ? <span className="text-xs text-muted-foreground">{refusalText(unavailable)}</span> : null}
      {error ? <span role="alert" className="mx-write-error">{error}</span> : null}
    </>
  );
}

export const chunk: KitChunk = { faces: { Button }, live: { Button: ButtonAdapter } };
