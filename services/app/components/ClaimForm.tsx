'use client';

import {appFetch as fetch} from '@/web/api-origin';
import { useState } from 'react';
import { Button, TokenInput } from '@/components/ui';

/** Paste an anonymous agent token to attach it (and its artifacts) to your account. */
export default function ClaimForm() {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage(null);
        const res = await fetch('/api/tokens/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.trim() }),
        });
        if (res.ok) {
          const body = (await res.json()) as { claimedArtifacts: number };
          setIsError(false);
          setMessage(`Claimed — ${body.claimedArtifacts} artifact(s) attached to your account.`);
          setToken('');
          window.location.reload();
        } else {
          setIsError(true);
          setMessage('That token is unknown, revoked, or belongs to another account.');
        }
      }}
    >
      <div className="flex gap-2">
        <TokenInput
          aria-label="Token to claim"
          placeholder="claim an agent token: mx_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Button type="submit" variant="ghost" aria-label="Claim token">
          claim
        </Button>
      </div>
      {message && <p className={`mt-2 text-xs ${isError ? 'text-danger' : 'text-muted'}`}>{message}</p>}
    </form>
  );
}
