/* @jsxImportSource solid-js */
/**
 * THE PAGE OWNER'S RESOLVERS PANEL. Each resolver on the head revision, each secret it declares with the one host
 * that may receive it and whether a value is set. Values are write-only: typed into a password input, sent once,
 * cleared, and never read back (the server returns names only). When the resolver declares `test`, Test connection
 * runs `{ <name> { test } }` as the owner against the listed revision and shows the string, or the refusal code with
 * the owner-only detail.
 */
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

interface PageResolver { name: string; backendId: string; version: string; test: boolean; secrets: Record<string, string>; set: string[] }
interface PageResolvers { revision: string; resolvers: PageResolver[] }
type TestOutcome = { ok: true; text: string } | { ok: false; text: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };
async function readResolvers(id: string): Promise<PageResolvers> {
  const response = await fetch(`/api/my/artifacts/${encodeURIComponent(id)}/resolvers`);
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
const refusal = (body: unknown, status: number): string => {
  const error = (body as { errors?: { message?: string; extensions?: { code?: string; detail?: string } }[] } | null)?.errors?.[0];
  if (error) return [error.extensions?.code ?? error.message ?? 'test_failed', error.extensions?.detail].filter(Boolean).join(': ');
  return (body as { error?: string } | null)?.error ?? `test_failed (${status})`;
};

function SecretRow(props: { resolver: PageResolver; name: string; host: string; set: boolean; onNames: (names: string[]) => void }): JSX.Element {
  const [value, setValue] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const send = async (method: 'PUT' | 'DELETE') => {
    setBusy(true); setError('');
    try {
      const body = method === 'PUT' ? { name: props.name, value: value() } : { name: props.name };
      const response = await fetch(`/api/my/resolvers/${encodeURIComponent(props.resolver.backendId)}/${encodeURIComponent(props.resolver.version)}/secrets`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      const answer = await response.json().catch(() => null) as { names?: string[]; error?: string } | null;
      if (!response.ok || !answer?.names) throw new Error(answer?.error ?? 'backend_secret_failed');
      if (method === 'PUT') setValue('');
      props.onNames(answer.names);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'backend_secret_failed'); }
    finally { setBusy(false); }
  };
  return <ListRow class="items-end">
    <div class="grid min-w-40 gap-1">
      <span class="font-mono text-sm text-fg">{props.name}</span>
      <span class="font-sans text-xs text-muted">{props.host}</span>
      <span><Badge tone={props.set ? 'accent' : 'dim'}>{props.set ? 'Set' : 'Not set'}</Badge></span>
    </div>
    <form class="flex flex-1 flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (value()) void send('PUT'); }}>
      <Field label={`Value for ${props.name}`} class="min-w-48 flex-1" error={error() || null}>
        <Input type="password" autocomplete="new-password" spellcheck={false} value={value()} placeholder={props.set ? 'Enter a new value to replace it' : 'Paste the value'} disabled={busy()} onInput={(event) => setValue(event.currentTarget.value)} />
      </Field>
      <Button type="submit" size="md" disabled={busy() || !value()}>Save secret</Button>
      <Show when={props.set}><Button type="button" variant="danger" disabled={busy()} onClick={() => void send('DELETE')}>Remove secret</Button></Show>
    </form>
  </ListRow>;
}

function ResolverSection(props: { id: string; revision: string; resolver: PageResolver }): JSX.Element {
  const [set, setSet] = createSignal(props.resolver.set);
  const [testing, setTesting] = createSignal(false);
  const [outcome, setOutcome] = createSignal<TestOutcome | null>(null);
  const names = () => Object.keys(props.resolver.secrets);
  const test = async () => {
    setTesting(true); setOutcome(null);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(props.id)}/graphql`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ query: `query ResolverTest { ${props.resolver.name} { test } }`, revision: props.revision }) });
      const body = await response.json().catch(() => null) as { data?: Record<string, { test?: unknown } | null>; errors?: unknown[] } | null;
      const text = body?.data?.[props.resolver.name]?.test;
      setOutcome(response.ok && !body?.errors?.length && typeof text === 'string' ? { ok: true, text } : { ok: false, text: refusal(body, response.status) });
    } catch { setOutcome({ ok: false, text: 'test_failed' }); }
    finally { setTesting(false); }
  };
  return <Panel label={`Resolver ${props.resolver.name}`} padding="sm" title={<span class="font-mono">{props.resolver.name}</span>}
    actions={<Show when={props.resolver.test}><Button variant="secondary" size="sm" disabled={testing()} onClick={() => void test()}>Test connection</Button></Show>}>
    <Show when={names().length} fallback={<StatusMessage kind="empty">This resolver declares no secrets.</StatusMessage>}>
      <ul class="m-0 list-none p-0"><For each={names()}>{(name) =>
        <SecretRow resolver={props.resolver} name={name} host={props.resolver.secrets[name] ?? ''} set={set().includes(name)} onNames={(next) => { setSet(next); setOutcome(null); }} />}
      </For></ul>
    </Show>
    <Show when={testing()}><StatusMessage kind="loading">Testing the connection…</StatusMessage></Show>
    <Show when={outcome()}>{(result) => <div class="mt-3"><Show when={result().ok} fallback={<StatusMessage kind="error">{result().text}</StatusMessage>}><StatusMessage kind="notice">{result().text}</StatusMessage></Show></div>}</Show>
  </Panel>;
}

export default function ResolversPanel(props: { id: string }): JSX.Element {
  const [page] = createResource(() => props.id, readResolvers);
  return <div class="grid gap-4">
    <p class="m-0 font-sans text-sm text-muted">Secret values are stored encrypted, sent only to their bound host, and never shown again.</p>
    <Show when={!page.loading} fallback={<StatusMessage kind="loading">Loading resolvers…</StatusMessage>}>
      <Show when={!page.error && page()} keyed fallback={<StatusMessage kind="error">Resolvers are unavailable. Refresh and try again.</StatusMessage>}>{(current) =>
        <Show when={current.resolvers.length} fallback={<StatusMessage kind="empty">This page has no resolvers.</StatusMessage>}>
          <For each={current.resolvers}>{(resolver) => <ResolverSection id={props.id} revision={current.revision} resolver={resolver} />}</For>
        </Show>}
      </Show>
    </Show>
  </div>;
}
