'use client';

import { Ban } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, MicroLabel, PANEL, TABLE_ROW } from '@/components/ui';

export interface UserTokenView {
  id: string;
  name: string | null;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  deleted_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

function relativeTime(iso: string | null, now = Date.now()): string {
  if (iso === null) return 'never';
  const delta = new Date(iso).getTime() - now;
  const future = delta > 0;
  const absolute = Math.abs(delta);
  const [amount, unit] = absolute < 60 * 60 * 1000
    ? [Math.max(1, Math.floor(absolute / (60 * 1000))), 'm']
    : absolute < 24 * 60 * 60 * 1000
      ? [Math.floor(absolute / (60 * 60 * 1000)), 'h']
      : [Math.floor(absolute / (24 * 60 * 60 * 1000)), 'd'];
  return future ? `in ${amount}${unit}` : `${amount}${unit} ago`;
}

const statusDot = (status: UserTokenView['status']): string =>
  status === 'active' ? 'bg-accent' : status === 'expired' ? 'bg-danger' : 'bg-faint';

/** The user's machines: every token minted for/claimed by this account, with revoke. */
export default function TokensPanel({ tokens: initial = [] }: { tokens?: UserTokenView[] }) {
  const [tokens, setTokens] = useState<UserTokenView[]>(initial);
  useEffect(() => {
    void fetch('/api/my/tokens').then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (body && Array.isArray(body.tokens)) setTokens(body.tokens as UserTokenView[]);
    }).catch(() => null);
  }, []);
  const [error, setError] = useState<string | null>(null);

  if (tokens.length === 0) return null;

  return (
    <section>
      <div className={PANEL}>
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr>
              {(
                [['name', ''], ['status', 'w-16 sm:w-24'], ['expires', 'w-16 sm:w-24'], ['last used', 'w-20 sm:w-24'], ['action', 'w-20 sm:w-28']] as const
              ).map(([h, w]) => (
                <th key={h} className={`px-2 py-2.5 sm:px-4 ${w}`}>
                  <MicroLabel>{h}</MicroLabel>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t, i) => (
              <tr
                key={t.id}
                aria-label={`Token row ${t.name ?? t.id}`}
                className={`${TABLE_ROW} reveal`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <td className="px-2 py-2 sm:px-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-label={`Token ${t.name ?? t.id} ${t.status} status dot`}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(t.status)}`}
                    />
                    <span className="min-w-0 truncate">{t.name ?? <span className="text-faint">(unnamed)</span>}</span>
                  </span>
                </td>
                <td aria-label={`Token ${t.name ?? t.id} status`} className="px-2 py-2 text-xs text-muted sm:px-4">
                  {t.status}
                </td>
                <td aria-label={`Token ${t.name ?? t.id} expires`} className="whitespace-nowrap px-2 py-2 text-xs text-muted sm:px-4">
                  {relativeTime(t.expires_at)}
                </td>
                <td aria-label={`Token ${t.name ?? t.id} last used`} className="whitespace-nowrap px-2 py-2 text-xs text-muted sm:px-4">
                  {relativeTime(t.last_used_at)}
                </td>
                <td className="px-2 py-2 sm:px-4">
                  {t.status === 'revoked' ? (
                    <span className="text-xs text-faint">—</span>
                  ) : (
                    <Button
                      variant="danger"
                      aria-label={`Revoke token ${t.name ?? t.id}`}
                      onClick={async () => {
                        if (!confirm(`Revoke "${t.name ?? t.id}"? Agents using it stop working immediately.`)) return;
                        const res = await fetch(`/api/my/tokens/${t.id}`, { method: 'DELETE' });
                        if (res.ok) window.location.reload();
                        else setError('Could not revoke that token.');
                      }}
                    >
                      <span className="flex items-center gap-1"><Ban size={11} /> revoke</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
