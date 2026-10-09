/* @jsxImportSource solid-js */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { Copy } from 'lucide-solid';
import { Badge, Button, PANEL } from './ui';
import { Tooltip } from './Tooltip';
import { copyText } from '../lib/copy-text';
import { CustomDomainPaths } from './CustomDomainPaths';

interface Domain { hostname: string; status: 'pending' | 'verified'; txtName: string; txtValue: string; target: string | null; verifiedAt: string | null; missingSince: string | null; homepageArtifactId: string | null; pathOverrides: Array<{ path: string; artifactId: string }> }
interface DomainSettings { enabled: boolean; target: string | null; targetAddresses: string[]; domain: Domain | null; homepageOptions?: Array<{ id: string; title: string }> }
const ATTACH_REFUSALS: Record<string, string> = { invalid_hostname: 'enter a domain name like blog.example.com — no https://, path or port, and not an artifactbin address', taken: 'another account already uses that domain', limit: 'an account holds one domain — remove this one first', disabled: 'custom domains are not available on this server right now' };
function verifyRefusal(error: string, domain: Domain, target: string | null): string {
  switch (error) {
    case 'txt_missing': return `The TXT record at ${domain.txtName} with the value shown was not found yet. DNS changes can take a few minutes to appear.`;
    case 'not_pointing': return `${domain.hostname} does not point at ${target ?? 'our servers'} yet. If your DNS host proxies it (Cloudflare's orange cloud), set the record to DNS only.`;
    case 'caa_blocks': return `A CAA record on ${domain.hostname} does not allow Let's Encrypt, which issues its certificate. Add a CAA record: 0 issue "letsencrypt.org".`;
    case 'taken': return `Another account has already verified ${domain.hostname}.`;
    case 'disabled': return 'Verification is paused on this server right now; your domain will wait.';
    default: return 'Could not verify that domain.';
  }
}
const bare = (hostname: string) => hostname.split('.').length === 2;
function RecordRow(props: { type: string; name: string; value: string; what: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const copy = (value: string) => { void copyText(value).then((ok) => { if (ok) setCopied(true); }); };
  return <tr class="border-t border-edge align-top"><td class="py-2 pr-3 font-mono text-xs text-muted">{props.type}</td><td class="py-2 pr-3"><span class="flex items-center gap-1 break-all font-mono text-xs">{props.name}<Tooltip content={copied() ? 'Copied' : 'Copy'}><button type="button" aria-label={`Copy ${props.what} name`} onClick={() => copy(props.name)} class="shrink-0 rounded-md p-1.5 text-muted hover:bg-raised"><Copy size={13} /></button></Tooltip></span></td><td class="py-2"><span class="flex items-center gap-1 break-all font-mono text-xs">{props.value}<Tooltip content={copied() ? 'Copied' : 'Copy'}><button type="button" aria-label={`Copy ${props.what} value`} onClick={() => copy(props.value)} class="shrink-0 rounded-md p-1.5 text-muted hover:bg-raised"><Copy size={13} /></button></Tooltip></span></td></tr>;
}

export function CustomDomainCard(): JSX.Element {
  const [settings, setSettings] = createSignal<DomainSettings | null>(null);
  const [hostname, setHostname] = createSignal('');
  const [homepage, setHomepage] = createSignal('');
  const [status, setStatus] = createSignal<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const load = async () => { const response = await fetch('/api/my/domain', { cache: 'no-store' }).catch(() => null); const body = response?.ok ? await response.json().catch(() => null) as DomainSettings | null : null; if (body) setHomepage(body.domain?.homepageArtifactId ?? ''); setSettings(body && typeof body.enabled === 'boolean' ? { ...body, targetAddresses: body.targetAddresses ?? [] } : null); };
  onMount(() => void load());
  const send = async (method: string, path: string, body?: object) => { setBusy(true); setStatus(null); const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).catch(() => null); setBusy(false); return response; };
  const attach = async () => { const response = await send('POST', '/api/my/domain', { hostname: hostname() }); if (!response) { setStatus({ tone: 'error', text: 'could not reach the server' }); return; } const body = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) { setStatus({ tone: 'error', text: ATTACH_REFUSALS[body.error ?? ''] ?? 'could not add that domain' }); return; } setHostname(''); await load(); };
  const verify = async () => { const domain = settings()?.domain; if (!domain) return; const response = await send('POST', '/api/my/domain/verify', { hostname: domain.hostname }); if (!response) { setStatus({ tone: 'error', text: 'could not reach the server' }); return; } const body = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) { setStatus({ tone: 'error', text: verifyRefusal(body.error ?? '', domain, settings()?.target ?? domain.target) }); return; } setStatus({ tone: 'ok', text: `Verified. ${domain.hostname} now serves your public documents.` }); await load(); };
  const remove = async () => { const response = await send('DELETE', '/api/my/domain'); if (!response?.ok) { setStatus({ tone: 'error', text: 'could not remove the domain' }); return; } await load(); };
  const saveHomepage = async () => {
    const response = await send('PATCH', '/api/my/domain', { homepageArtifactId: homepage() || null });
    if (!response?.ok) { setStatus({ tone: 'error', text: 'Could not save the homepage. Choose one of your public documents and try again.' }); return; }
    setBusy(true);
    await load();
    setBusy(false);
    setStatus({ tone: 'ok', text: 'Homepage saved.' });
  };
  const domain = () => settings()?.domain;
  const savePath = async (path: string, artifactId: string | null): Promise<string | null> => {
    const response = await send('PATCH', '/api/my/domain', { path, artifactId });
    if (!response?.ok) return (await response?.json().catch(() => ({})) as { error?: string } | undefined)?.error ?? 'network';
    setBusy(true); await load(); setBusy(false); return null;
  };
  const target = () => settings()?.target ?? domain()?.target ?? null;
  return <Show when={settings() && (settings()!.enabled || settings()!.domain)}><section aria-labelledby="custom-domain-heading"><h2 id="custom-domain-heading" class="text-base font-semibold">Custom domain</h2><p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Publish your public documents on your own domain. Choose a homepage or show your document listing.</p><div class={`${PANEL} mt-4 p-4 sm:p-5`}>
    <Show when={domain()} fallback={<form class="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void attach(); }}><input aria-label="Custom domain" placeholder="blog.example.com" autocomplete="off" spellcheck={false} value={hostname()} onInput={event => setHostname(event.currentTarget.value)} class="min-w-0 flex-1 rounded-[4px] border border-edge bg-surface px-3 py-2 text-sm" /><Button type="submit" aria-label="Add custom domain" disabled={busy() || !hostname().trim()}>Add domain</Button></form>}>
      {current => <><div class="flex flex-wrap items-center gap-2"><span class="break-all font-mono text-sm font-medium">{current().hostname}</span><Badge tone={current().status === 'verified' ? 'accent' : 'dim'}>{current().status}</Badge></div><form class="mt-5 border-t border-edge pt-4" onSubmit={event => { event.preventDefault(); void saveHomepage(); }}>
        <label for="domain-homepage" class="text-sm font-medium">Homepage</label>
        <p class="mt-1 text-xs leading-relaxed text-muted">What visitors see at your domain’s root. Only your public documents can be selected.</p>
        <div class="mt-3 flex flex-wrap gap-2"><select disabled={busy()} id="domain-homepage" aria-label="Domain homepage" value={homepage()} onChange={event => setHomepage(event.currentTarget.value)} class="min-w-0 flex-1 rounded-[4px] border border-edge-bright bg-surface px-3 py-2 text-sm">
          <option value="" selected={homepage() === ''}>Document listing (default)</option>
          <Show when={current().homepageArtifactId && !settings()?.homepageOptions?.some(option => option.id === current().homepageArtifactId)}><option value={current().homepageArtifactId!} selected={homepage() === current().homepageArtifactId}>Selected document unavailable — showing listing</option></Show>
          <For each={settings()?.homepageOptions ?? []}>{option => <option value={option.id} selected={homepage() === option.id}>{option.title || 'Untitled document'}</option>}</For>
        </select><Button type="submit" aria-label="Save homepage" disabled={busy() || homepage() === (current().homepageArtifactId ?? '')}>Save homepage</Button></div>
        <p class="mt-2 text-xs leading-relaxed text-muted">If your homepage is deleted or no longer public, visitors will see your document listing.</p>
      </form><CustomDomainPaths hostname={current().hostname} paths={current().pathOverrides ?? []} documents={settings()?.homepageOptions ?? []} busy={busy()} save={savePath} /><Show when={current().status === 'verified' && current().missingSince}><p role="alert" class="mt-2 font-mono text-xs text-danger">The TXT record is missing. Put it back within three days of {new Date(current().missingSince!).toLocaleDateString()} or the domain is detached.</p></Show><details open={current().status !== 'verified'} class="mt-5 border-t border-edge pt-4"><summary class="cursor-pointer text-sm font-medium">DNS records</summary><p class="mt-3 text-xs leading-relaxed text-muted">{current().status === 'verified' ? 'Keep these records in place at your DNS host:' : 'Add these two records at your DNS host, then press verify:'}</p>
        <table class="mt-2 w-full table-fixed border-collapse text-left" aria-label="DNS records"><thead><tr class="font-mono text-[11px] uppercase tracking-wide text-faint"><th scope="col" class="w-16 pb-1 pr-3 font-normal">type</th><th scope="col" class="pb-1 pr-3 font-normal">name</th><th scope="col" class="pb-1 font-normal">value</th></tr></thead><tbody><Show when={target()}>{value => <Show when={bare(current().hostname)} fallback={<RecordRow type="CNAME" name={current().hostname} value={value()} what="routing record" />}><RecordRow type="ALIAS" name={current().hostname} value={value()} what="routing record" /><For each={settings()?.targetAddresses.filter(address => !address.includes(':'))}>{address => <RecordRow type="A" name={current().hostname} value={address} what="A record" />}</For></Show>}</Show><RecordRow type="TXT" name={current().txtName} value={current().txtValue} what="TXT record" /></tbody></table>
        <Show when={target() && bare(current().hostname)}><p class="mt-2 font-mono text-[11px] leading-relaxed text-faint">A bare domain cannot take a CNAME. Use ALIAS, ANAME or CNAME flattening if your DNS host offers it; otherwise add the A record.</p></Show></details><div class="mt-4 flex flex-wrap items-center gap-2"><Show when={settings()?.enabled}><Button type="button" aria-label="Verify custom domain" disabled={busy()} onClick={() => void verify()}>Verify domain</Button></Show><Button variant="danger" type="button" aria-label="Remove custom domain" disabled={busy()} onClick={() => void remove()}>Remove domain</Button></div><Show when={!settings()?.enabled && current().status === 'pending'}><p class="mt-2 font-mono text-xs text-muted">Verification is paused on this server right now; your domain will wait.</p></Show>
      </>}
    </Show>
    <Show when={status()}>{message => <p role="status" class={`mt-3 font-mono text-xs leading-relaxed ${message().tone === 'ok' ? 'text-accent' : 'text-danger'}`}>{message().text}</p>}</Show>
  </div></section></Show>;
}
