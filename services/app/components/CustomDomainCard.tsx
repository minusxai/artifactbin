'use client';

/**
 * CUSTOM DOMAIN — the account settings section (web/pages/Account).
 *
 * A person attaches ONE hostname, adds the two DNS records it shows, and
 * presses Verify; lib/custom-domains holds every rule and the API
 * (app/api/my/domain) only translates. The section appears when attaching is
 * on (FLAG__CUSTOM_DOMAINS) or when the account already has a domain, so a
 * domain can always be removed even while the flag is off.
 */
import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';
import { Badge, Button, Input, MicroLabel, PANEL } from '@/components/ui';

interface Domain {
  hostname: string;
  status: 'pending' | 'verified';
  txtName: string;
  txtValue: string;
  target: string | null;
  verifiedAt: string | null;
  missingSince: string | null;
}
interface DomainSettings { enabled: boolean; target: string | null; targetAddresses: string[]; domain: Domain | null }

/** Why an attach was refused, in words. */
export const ATTACH_REFUSALS: Record<string, string> = {
  invalid_hostname: 'enter a domain name like blog.example.com — no https://, path or port, and not an artifactbin address',
  taken: 'another account already uses that domain',
  limit: 'an account holds one domain — remove this one first',
  disabled: 'custom domains are not available on this server right now',
};

/** Why Verify failed, in words that say what to change. */
export function verifyRefusal(error: string, domain: Domain, target: string | null): string {
  switch (error) {
    case 'txt_missing':
      return `The TXT record at ${domain.txtName} with the value shown was not found yet. DNS changes can take a few minutes to appear.`;
    case 'not_pointing':
      return `${domain.hostname} does not point at ${target ?? 'our servers'} yet. If your DNS host proxies it (Cloudflare's orange cloud), set the record to DNS only.`;
    case 'caa_blocks':
      return `A CAA record on ${domain.hostname} does not allow Let's Encrypt, which issues its certificate. Add a CAA record: 0 issue "letsencrypt.org".`;
    case 'taken':
      return `Another account has already verified ${domain.hostname}.`;
    case 'disabled':
      return 'Verification is paused on this server right now; your domain will wait.';
    default:
      return 'Could not verify that domain.';
  }
}

/** A bare domain (two labels) cannot carry a CNAME: it needs ALIAS/ANAME or an A record. */
const isBare = (hostname: string) => hostname.split('.').length === 2;

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip content={copied ? 'Copied' : 'Copy'}>
      <button
        type="button"
        aria-label={label}
        className="shrink-0 rounded-md p-1.5 text-muted hover:bg-raised hover:text-fg"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
        }}
      >
        <Copy size={13} />
      </button>
    </Tooltip>
  );
}

function RecordRow({ type, name, value, what }: { type: string; name: string; value: string; what: string }) {
  return (
    <tr className="border-t border-edge align-top">
      <td className="py-2 pr-3 font-mono text-xs text-muted">{type}</td>
      <td className="py-2 pr-3"><span className="flex items-center gap-1 break-all font-mono text-xs">{name}<CopyValue label={`Copy ${what} name`} value={name} /></span></td>
      <td className="py-2"><span className="flex items-center gap-1 break-all font-mono text-xs">{value}<CopyValue label={`Copy ${what} value`} value={value} /></span></td>
    </tr>
  );
}

export default function CustomDomainCard() {
  const [settings, setSettings] = useState<DomainSettings | null>(null);
  const [hostname, setHostname] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/my/domain', { cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as DomainSettings | null) : null;
    setSettings(body && typeof body.enabled === 'boolean' ? { ...body, targetAddresses: body.targetAddresses ?? [] } : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!settings || (!settings.enabled && !settings.domain)) return null;
  const { domain, enabled } = settings;
  const target = settings.target ?? domain?.target ?? null;

  const send = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    setStatus(null);
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => null);
    setBusy(false);
    return res;
  };

  const attach = async () => {
    const res = await send('POST', '/api/my/domain', { hostname });
    if (!res) return setStatus({ tone: 'error', text: 'could not reach the server' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return setStatus({ tone: 'error', text: ATTACH_REFUSALS[body.error ?? ''] ?? 'could not add that domain' });
    setHostname('');
    await load();
  };

  const verify = async () => {
    if (!domain) return;
    const res = await send('POST', '/api/my/domain/verify', { hostname: domain.hostname });
    if (!res) return setStatus({ tone: 'error', text: 'could not reach the server' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return setStatus({ tone: 'error', text: verifyRefusal(body.error ?? '', domain, target) });
    setStatus({ tone: 'ok', text: `Verified. ${domain.hostname} now serves your public documents.` });
    await load();
  };

  const remove = async () => {
    const res = await send('DELETE', '/api/my/domain');
    if (!res || !res.ok) return setStatus({ tone: 'error', text: 'could not remove the domain' });
    await load();
  };

  return (
    <section aria-labelledby="custom-domain-heading">
      <h2 id="custom-domain-heading" className="text-base font-semibold"><span className="text-accent">&gt;</span> custom domain</h2>
      <p className="mt-2 font-mono text-sm leading-relaxed text-muted">
        Serve your public documents at your own domain: its home page lists them, and each one is a post without app chrome.
      </p>
      <div className={`${PANEL} mt-4 p-4`}>
        {!domain ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void attach(); }}>
            <span className="min-w-0 flex-1 sm:max-w-80">
              <Input
                aria-label="Custom domain"
                placeholder="blog.example.com"
                autoComplete="off"
                spellCheck={false}
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
            </span>
            <Button type="submit" aria-label="Add custom domain" disabled={busy || !hostname.trim()}>add</Button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <MicroLabel>domain</MicroLabel>
              <span className="font-mono text-sm">{domain.hostname}</span>
              <Badge tone={domain.status === 'verified' ? 'accent' : 'dim'}>{domain.status}</Badge>
            </div>
            {domain.status === 'verified' && domain.missingSince && (
              <p role="alert" className="mt-2 font-mono text-xs text-danger">
                The TXT record is missing. Put it back within three days of {new Date(domain.missingSince).toLocaleDateString()} or the domain is detached.
              </p>
            )}
            <p className="mt-3 font-mono text-xs leading-relaxed text-muted">
              {domain.status === 'verified' ? 'Keep these records in place at your DNS host:' : 'Add these two records at your DNS host, then press verify:'}
            </p>
            <table className="mt-2 w-full border-collapse text-left" aria-label="DNS records">
              <thead>
                <tr className="font-mono text-[11px] uppercase tracking-wide text-faint">
                  <th scope="col" className="pb-1 pr-3 font-normal">type</th>
                  <th scope="col" className="pb-1 pr-3 font-normal">name</th>
                  <th scope="col" className="pb-1 font-normal">value</th>
                </tr>
              </thead>
              <tbody>
                {target && (isBare(domain.hostname) ? (
                  <>
                    <RecordRow type="ALIAS" name={domain.hostname} value={target} what="routing record" />
                    {settings.targetAddresses.filter((a) => !a.includes(':')).map((address) => (
                      <RecordRow key={address} type="A" name={domain.hostname} value={address} what="A record" />
                    ))}
                  </>
                ) : (
                  <RecordRow type="CNAME" name={domain.hostname} value={target} what="routing record" />
                ))}
                <RecordRow type="TXT" name={domain.txtName} value={domain.txtValue} what="TXT record" />
              </tbody>
            </table>
            {target && isBare(domain.hostname) && (
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
                A bare domain cannot take a CNAME. Use ALIAS, ANAME or CNAME flattening if your DNS host offers it; otherwise add the A record.
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              {enabled && (
                <Button type="button" aria-label="Verify custom domain" disabled={busy} onClick={() => void verify()}>
                  verify
                </Button>
              )}
              <Button type="button" aria-label="Remove custom domain" disabled={busy} onClick={() => void remove()}>
                remove
              </Button>
            </div>
            {!enabled && domain.status === 'pending' && (
              <p className="mt-2 font-mono text-xs text-muted">Verification is paused on this server right now; your domain will wait.</p>
            )}
          </>
        )}
        {status && (
          <p role="status" className={`mt-3 font-mono text-xs leading-relaxed ${status.tone === 'ok' ? 'text-accent' : 'text-danger'}`}>
            {status.text}
          </p>
        )}
      </div>
    </section>
  );
}
