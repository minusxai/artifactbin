/* @jsxImportSource solid-js */
/**
 * The settings page's default connection (lib/connections, `DATASETS__DEFAULT_CONNECTION`): whether this install has
 * one, its connector and shown fields (host, port, database; never the user or the secret), and "Test connection".
 * Read-only: the install sets it in its environment.
 */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { apiFetch } from '../lib/api';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';

type Status = { configured: false } | { configured: true; connector: string; label: string; fields: Record<string, string | number> };
type Tested = { ok: true; latencyMs: number } | { ok: false; error: { code: string; message: string } };
const FIELD_LABELS: Record<string, string> = { host: 'Host', port: 'Port', database: 'Database', project: 'Project', location: 'Location', dataset: 'Dataset' };

export function DefaultConnectionPanel(): JSX.Element {
  const [status, setStatus] = createSignal<Status | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<{ kind: 'notice' | 'error'; text: string } | null>(null);
  onMount(() => { void apiFetch('/api/default-connection').then((r) => (r.ok ? r.json() : null)).then((s: Status | null) => setStatus(s)).catch(() => {}); });
  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const response = await apiFetch('/api/default-connection/test', 'POST', {});
      const body = await response.json() as Tested & { message?: string };
      if (!response.ok) setResult({ kind: 'error', text: body.message ?? 'Could not test the connection. Try again.' });
      else setResult(body.ok ? { kind: 'notice', text: `Connected in ${body.latencyMs} ms.` } : { kind: 'error', text: `${body.error.code}: ${body.error.message}` });
    } catch { setResult({ kind: 'error', text: 'Could not test the connection. Try again.' }); }
    finally { setTesting(false); }
  };
  return <Show when={status()}>{(s) => <Panel label="Default connection" title="Default connection" class="font-sans">
    <Show when={s().configured ? s() as Extract<Status, { configured: true }> : null} fallback={<p class="text-sm text-muted">This install has no default connection. Pages read stored datasets only.</p>}>{(c) => <>
      <p class="text-sm text-muted">Every signed-in person can read this database, read-only, from a page or an agent.</p>
      <dl class="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        <dt class="text-muted">Connector</dt><dd>{c().label}</dd>
        <For each={Object.entries(c().fields)}>{([name, value]) => <><dt class="text-muted">{FIELD_LABELS[name] ?? name}</dt><dd class="break-all">{String(value)}</dd></>}</For>
      </dl>
      <div class="mt-4"><Button variant="secondary" type="button" disabled={testing()} onClick={() => void test()}>{testing() ? 'Testing…' : 'Test connection'}</Button></div>
      <Show when={result()}>{(r) => <StatusMessage kind={r().kind} class="mt-3">{r().text}</StatusMessage>}</Show>
    </>}</Show>
  </Panel>}</Show>;
}
