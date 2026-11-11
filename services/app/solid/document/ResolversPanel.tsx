/* @jsxImportSource solid-js */
/**
 * THE PAGE OWNER'S RESOLVERS PANEL. Each resolver on the head revision, each secret it declares with the one host
 * that may receive it and whether a value is set. Values are write-only: typed into a password input, sent once,
 * cleared, and never read back (the server returns names only). When the resolver declares `test`, Test connection
 * runs it as the owner against the listed revision and shows the string, or the refusal code with the owner-only
 * detail: a function file's `test` function as `GET /fn/test`, a legacy file's field as `{ <name> { test } }`.
 *
 * A name bound to a database kind (RESOLVER_DATABASE_KINDS: `postgres`, `mysql`) is a database connection of that
 * kind: host, port (the kind's default to start), database, user and password, saved together (write-only, like a
 * secret value). The password stays in the runner's worker process and never reaches resolver code; the hint still
 * says to use a read-only database user, since resolver code runs whatever SQL that user may. When the deployment
 * names its outbound addresses (`GET /api/outbound-ips`), each connection row lists them to allow in the database's
 * firewall, with a copy button; none configured (or the read fails), the line is absent. Under Advanced, an optional
 * CA certificate (PEM) for providers that sign with their own authority (RDS, Cloud SQL, Supabase), checked as the
 * contracts check it (`databaseConnection`) and sent only when filled. Advanced opens by itself when a CA is the likely
 * fix: the host is an RDS or Supabase name, or Test connection answered `tls_untrusted_certificate`.
 *
 * A name declared `'viewer'` (VIEWER_CONNECTION_KIND) is a VIEWER CONNECTION BINDING, not a secret: the author picks
 * one of the data services this server trusts (`data_services` on the resolvers read) and writes the parameters that
 * service takes (a JSON object, read by the service only), and saves `{service, params}`. The server asks the service
 * for a session as the author before storing it. The current binding comes with the resolver (`bindings`); every
 * refusal (`data_service_not_configured`, `binding_forbidden`, `binding_rejected`, `data_service_unavailable`,
 * `invalid_binding`) is said in plain words.
 *
 * A resolver that schedules functions (`export const schedule`, lib/function-schedules) lists each with its interval,
 * its last outcome and its next run; a failed run shows its code, the function's message and the owner-only detail,
 * as Test connection does.
 */
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { isResolverDatabaseKind, VIEWER_CONNECTION_KIND, type ResolverDatabaseKind, type ViewerBinding } from '@artifactbin/contracts';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { CopyBlock } from '../ui/CopyBlock';
import { Disclosure } from '../ui/Disclosure';
import { Field, Input, Textarea } from '../ui/Field';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Badge } from '../ui/ui';

interface FunctionSchedule { name: string; every: string; nextRunAt: string; running: boolean; failures: number; lastRunAt: string | null; lastStatus: 'ok' | 'failed' | null; lastError: string | null; lastMessage: string | null; lastDetail: string | null }
interface PageResolver { name: string; backendId: string; version: string; test: boolean; functions?: boolean; secrets: Record<string, string>; set: string[]; bindings?: Record<string, ViewerBinding>; schedules?: FunctionSchedule[] }
interface PageResolvers { revision: string; resolvers: PageResolver[]; data_services?: string[] }
type TestOutcome = { ok: true; text: string } | { ok: false; text: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };
async function readResolvers(id: string): Promise<PageResolvers> {
  const response = await fetch(`/api/my/artifacts/${encodeURIComponent(id)}/resolvers`);
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
/** The deployment's outbound addresses; any failure reads as none, since the line is only a hint. */
async function readOutboundIps(): Promise<string[]> {
  try {
    const response = await fetch('/api/outbound-ips');
    const body = response.ok ? await response.json() as { ips?: unknown } : null;
    return Array.isArray(body?.ips) ? body.ips.filter((ip): ip is string => typeof ip === 'string') : [];
  } catch { return []; }
}
const refusal = (body: unknown, status: number): string => {
  const failed = body as { error?: string; message?: string; detail?: string } | null;
  if (typeof failed?.error === 'string' && typeof failed.message === 'string')
    return [failed.error, failed.message, failed.detail].filter(Boolean).join(': ');
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

const CONNECTION_FIELDS = [['host', 'Host', 'text'], ['port', 'Port', 'number'], ['database', 'Database', 'text'], ['user', 'User', 'text'], ['password', 'Password', 'password']] as const;
type ConnectionField = typeof CONNECTION_FIELDS[number][0];
/** Each kind's label and default port; a kind added to RESOLVER_DATABASE_KINDS must be added here (a type error otherwise). */
const DATABASE_KIND: Record<ResolverDatabaseKind, { label: string; port: string }> = { postgres: { label: 'Postgres', port: '5432' }, mysql: { label: 'MySQL', port: '3306' } };
/** `databaseConnection`'s rule for `ca` (html-backend-secrets/contracts.ts): a PEM certificate, at most 12 KiB. */
const CA_MARKER = '-----BEGIN CERTIFICATE-----', CA_MAX = 12 * 1024;
const caProblem = (ca: string): string | null => !ca.trim() ? null : ca.length > CA_MAX ? 'The CA certificate must be 12 KiB or less.' : !ca.includes(CA_MARKER) ? `Paste a PEM certificate: it starts with ${CA_MARKER}` : null;
/** Hosts whose provider signs with its own certificate authority (Cloud SQL is usually an IP address, so not here). */
const OWN_CA_HOST = /\.rds\.amazonaws\.com(?:\.cn)?$|\.supabase\.(?:co|com)$/i;
const CA_HELP = <>Needed when your provider signs the server's certificate with its own authority. AWS RDS: download your region's bundle from truststore.pki.rds.amazonaws.com. Cloud SQL: download the server CA certificate from the instance's Connections, Security page. Supabase: download the certificate from Database Settings, SSL Configuration.</>;

function ConnectionRow(props: { resolver: PageResolver; name: string; kind: ResolverDatabaseKind; set: boolean; outboundIps: string[]; untrusted: boolean; onNames: (names: string[]) => void }): JSX.Element {
  // A row's kind is its resolver version's, fixed for the row's life.
  const kind = DATABASE_KIND[props.kind];
  const [values, setValues] = createSignal<Record<ConnectionField, string>>({ host: '', port: kind.port, database: '', user: '', password: '' });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [ca, setCa] = createSignal('');
  const complete = () => CONNECTION_FIELDS.every(([key]) => values()[key].trim() !== '') && !caProblem(ca());
  const caLikely = () => props.untrusted || OWN_CA_HOST.test(values().host.trim()) || ca().trim() !== '';
  const send = async (method: 'PUT' | 'DELETE') => {
    setBusy(true); setError('');
    try {
      const v = values();
      const body = method === 'PUT' ? { name: props.name, connection: { host: v.host.trim(), port: Number(v.port), database: v.database, user: v.user, password: v.password, ...(ca().trim() ? { ca: ca() } : {}) } } : { name: props.name };
      const response = await fetch(`/api/my/resolvers/${encodeURIComponent(props.resolver.backendId)}/${encodeURIComponent(props.resolver.version)}/secrets`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      const answer = await response.json().catch(() => null) as { names?: string[]; error?: string } | null;
      if (!response.ok || !answer?.names) throw new Error(answer?.error ?? 'backend_secret_failed');
      if (method === 'PUT') setValues({ ...v, password: '' });
      props.onNames(answer.names);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'backend_secret_failed'); }
    finally { setBusy(false); }
  };
  return <ListRow class="items-end">
    <div class="grid min-w-40 gap-1">
      <span class="font-mono text-sm text-fg">{props.name}</span>
      <span class="font-sans text-xs text-muted">{kind.label} connection</span>
      <span><Badge tone={props.set ? 'accent' : 'dim'}>{props.set ? 'Set' : 'Not set'}</Badge></span>
    </div>
    <form class="grid flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); if (complete()) void send('PUT'); }}>
      <div class="flex flex-wrap items-end gap-2">
        <For each={CONNECTION_FIELDS}>{([key, label, type]) =>
          <Field label={`${label} for ${props.name}`} class="min-w-32 flex-1">
            <Input type={type} autocomplete={type === 'password' ? 'new-password' : 'off'} spellcheck={false} value={values()[key]} disabled={busy()} onInput={(event) => setValues({ ...values(), [key]: event.currentTarget.value })} />
          </Field>}
        </For>
      </div>
      <Disclosure summary="Advanced" open={caLikely()}>
        <Field label={`CA certificate (PEM) for ${props.name}`} class="mt-2" hint={CA_HELP} error={caProblem(ca())}>
          <Textarea size="sm" spellcheck={false} autocomplete="off" rows={4} value={ca()} placeholder={`${CA_MARKER}\n…`} disabled={busy()} onInput={(event) => setCa(event.currentTarget.value)} />
        </Field>
      </Disclosure>
      <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
      <p class="m-0 font-sans text-xs text-muted">Use a read-only database user: resolver code can run any SQL that user is allowed. The password stays in the runner's worker process and never reaches resolver code. TLS with full certificate verification is required.</p>
      <Show when={props.outboundIps.length}>
        <div class="grid gap-1">
          <p class="m-0 font-sans text-xs text-muted">Allow these IPs in your database firewall:</p>
          <CopyBlock class="" text={props.outboundIps.join(', ')} label={`Copy the IPs to allow for ${props.name}`} />
        </div>
      </Show>
      <div class="flex gap-2">
        <Button type="submit" size="md" disabled={busy() || !complete()}>Save connection</Button>
        <Show when={props.set}><Button type="button" variant="danger" disabled={busy()} onClick={() => void send('DELETE')}>Remove connection</Button></Show>
      </div>
    </form>
  </ListRow>;
}

/** A binding refusal in plain words; an unknown code is shown as is. */
const BINDING_WORDS: Record<string, string> = {
  data_service_not_configured: 'This server trusts no data service by that name, so this connection cannot be bound.',
  binding_forbidden: 'The data service refused you a session with these parameters. You can only bind what you may read yourself.',
  binding_rejected: 'The data service does not accept these parameters.',
  data_service_unavailable: 'The data service did not answer. Try again in a moment.',
  invalid_binding: 'Choose a data service and write its parameters as a JSON object.',
};
const bindingWords = (code: string) => BINDING_WORDS[code] ?? code;
/** The params text as an object, or null when it is not a JSON object. */
const paramsOf = (text: string): Record<string, unknown> | null => {
  try { const value = JSON.parse(text.trim() || '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
};

function ViewerBindingRow(props: { resolver: PageResolver; name: string; set: boolean; binding: ViewerBinding | null; services: string[]; onNames: (names: string[]) => void }): JSX.Element {
  const [current, setCurrent] = createSignal<ViewerBinding | null>(props.binding);
  const [service, setService] = createSignal(props.binding?.service ?? (props.services.length === 1 ? props.services[0]! : ''));
  const [params, setParams] = createSignal(props.binding ? JSON.stringify(props.binding.params) : '{}');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const serviceOptions = () => {
    const options = props.services.map((id) => ({ value: id, label: id }));
    const bound = current();
    return bound && !props.services.includes(bound.service) ? [{ value: bound.service, label: bound.service }, ...options] : options;
  };
  const parsed = () => paramsOf(params());
  const changed = () => !current() || current()!.service !== service() || JSON.stringify(current()!.params) !== JSON.stringify(parsed());
  const ready = () => !!service() && !!parsed() && changed();
  const send = async (method: 'PUT' | 'DELETE') => {
    setBusy(true); setError('');
    try {
      const binding = { service: service(), params: parsed() ?? {} };
      const body = method === 'PUT' ? { name: props.name, binding } : { name: props.name };
      const response = await fetch(`/api/my/resolvers/${encodeURIComponent(props.resolver.backendId)}/${encodeURIComponent(props.resolver.version)}/secrets`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      const answer = await response.json().catch(() => null) as { names?: string[]; error?: string } | null;
      if (!response.ok || !answer?.names) throw new Error(answer?.error ?? 'backend_secret_failed');
      setCurrent(method === 'PUT' ? binding : null);
      if (method === 'DELETE') setParams('{}');
      props.onNames(answer.names);
    } catch (cause) { setError(bindingWords(cause instanceof Error ? cause.message : 'backend_secret_failed')); }
    finally { setBusy(false); }
  };
  return <ListRow class="items-end">
    <div role="group" aria-label={`Viewer connection ${props.name}`} class="grid w-full gap-2">
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-mono text-sm text-fg">{props.name}</span>
        <span class="font-sans text-xs text-muted">Connects as each viewer</span>
        <Badge tone={props.set && current() ? 'accent' : 'dim'}>{props.set && current() ? 'Bound' : 'Not bound'}</Badge>
      </div>
      <Show when={props.set && current()}>{(bound) => <p class="m-0 font-sans text-sm text-fg">Bound to {bound().service} with <span class="font-mono">{JSON.stringify(bound().params)}</span>.</p>}</Show>
      <form class="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (ready()) void send('PUT'); }}>
        <Field label={`Data service for ${props.name}`} class="min-w-48">
          <Select value={service()} options={serviceOptions()} placeholder={props.services.length ? 'Choose a data service' : 'No data service is configured'} disabled={busy() || !serviceOptions().length} onChange={(next) => { setService(next); setError(''); }} />
        </Field>
        <Field label={`Parameters for ${props.name}`} hint="A JSON object; only the data service reads it.">
          <Textarea size="sm" spellcheck={false} autocomplete="off" rows={3} value={params()} disabled={busy()} onInput={(event) => { setParams(event.currentTarget.value); setError(''); }} />
        </Field>
        <div class="flex gap-2">
          <Button type="submit" size="md" disabled={busy() || !ready()}>Save binding</Button>
          <Show when={props.set}><Button type="button" variant="danger" disabled={busy()} onClick={() => void send('DELETE')}>Remove binding</Button></Show>
        </div>
      </form>
      <Show when={!parsed()}><StatusMessage kind="error">The parameters must be a JSON object.</StatusMessage></Show>
      <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
      <p class="m-0 font-sans text-xs text-muted">Each viewer reads with their own access at that service. Someone without it sees the page with a data-access error, never your rows. Only the service and its parameters are stored, no password.</p>
    </div>
  </ListRow>;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function ScheduleRow(props: { schedule: FunctionSchedule }): JSX.Element {
  const s = () => props.schedule;
  const outcome = (): { text: string; tone: 'accent' | 'danger' | 'dim' | 'default' } => s().running ? { text: 'Running', tone: 'default' }
    : s().lastStatus === 'failed' ? { text: s().failures === 1 ? 'Failed once' : `Failed ${s().failures} times`, tone: 'danger' }
    : s().lastStatus === 'ok' ? { text: 'Last run succeeded', tone: 'accent' } : { text: 'Not run yet', tone: 'dim' };
  return <ListRow>
    <div class="grid min-w-40 flex-1 gap-1">
      <span class="font-mono text-sm text-fg">{s().name}</span>
      <span class="font-sans text-xs text-muted">{s().every}</span>
    </div>
    <div class="grid justify-items-end gap-1">
      <Badge tone={outcome().tone}>{outcome().text}</Badge>
      <span class="font-sans text-xs text-muted">Next run {when(s().nextRunAt)}</span>
    </div>
    <Show when={s().lastStatus === 'failed'}>
      <StatusMessage kind="error" class="w-full">
        {[s().lastError, s().lastMessage].filter(Boolean).join(': ')}
        <Show when={s().lastDetail}>{(detail) => <span class="block font-mono text-xs">{detail()}</span>}</Show>
      </StatusMessage>
    </Show>
  </ListRow>;
}

function ResolverSection(props: { id: string; revision: string; resolver: PageResolver; outboundIps: string[]; dataServices: string[] }): JSX.Element {
  const [set, setSet] = createSignal(props.resolver.set);
  const [testing, setTesting] = createSignal(false);
  const [outcome, setOutcome] = createSignal<TestOutcome | null>(null);
  const names = () => Object.keys(props.resolver.secrets);
  const untrusted = () => /tls_untrusted_certificate/.test(outcome()?.text ?? '');
  const test = async () => {
    setTesting(true); setOutcome(null);
    try {
      if (props.resolver.functions) {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(props.id)}/fn/test`, { headers: { 'x-page-revision': props.revision } });
        const body = await response.json().catch(() => null) as unknown;
        setOutcome(response.ok && typeof body === 'string' ? { ok: true, text: body } : { ok: false, text: refusal(body, response.status) });
        return;
      }
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
      <ul class="m-0 list-none p-0"><For each={names()}>{(name) => {
        const onNames = (next: string[]) => { setSet(next); setOutcome(null); };
        const kind = props.resolver.secrets[name];
        if (kind === VIEWER_CONNECTION_KIND) return <ViewerBindingRow resolver={props.resolver} name={name} set={set().includes(name)} binding={props.resolver.bindings?.[name] ?? null} services={props.dataServices} onNames={onNames} />;
        return isResolverDatabaseKind(kind)
          ? <ConnectionRow resolver={props.resolver} name={name} kind={kind} set={set().includes(name)} outboundIps={props.outboundIps} untrusted={untrusted()} onNames={onNames} />
          : <SecretRow resolver={props.resolver} name={name} host={props.resolver.secrets[name] ?? ''} set={set().includes(name)} onNames={onNames} />;
      }}
      </For></ul>
    </Show>
    <Show when={props.resolver.schedules?.length}>
      <ul class="m-0 mt-3 list-none p-0" aria-label="Scheduled functions"><For each={props.resolver.schedules}>{(schedule) => <ScheduleRow schedule={schedule} />}</For></ul>
    </Show>
    <Show when={testing()}><StatusMessage kind="loading">Testing the connection…</StatusMessage></Show>
    <Show when={outcome()}>{(result) => <div class="mt-3"><Show when={result().ok} fallback={<StatusMessage kind="error">{result().text}</StatusMessage>}><StatusMessage kind="notice">{result().text}</StatusMessage></Show></div>}</Show>
  </Panel>;
}

export default function ResolversPanel(props: { id: string }): JSX.Element {
  const [page] = createResource(() => props.id, readResolvers);
  const [outboundIps] = createResource(readOutboundIps, { initialValue: [] });
  return <div class="grid gap-4">
    <p class="m-0 font-sans text-sm text-muted">Secret values are stored encrypted, sent only to their bound host, and never shown again.</p>
    <Show when={!page.loading} fallback={<StatusMessage kind="loading">Loading resolvers…</StatusMessage>}>
      <Show when={!page.error && page()} keyed fallback={<StatusMessage kind="error">Resolvers are unavailable. Refresh and try again.</StatusMessage>}>{(current) =>
        <Show when={current.resolvers.length} fallback={<StatusMessage kind="empty">This page has no resolvers.</StatusMessage>}>
          <For each={current.resolvers}>{(resolver) => <ResolverSection id={props.id} revision={current.revision} resolver={resolver} outboundIps={outboundIps()} dataServices={current.data_services ?? []} />}</For>
        </Show>}
      </Show>
    </Show>
  </div>;
}
