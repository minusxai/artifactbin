'use client';

/**
 * The account's public handle — the name in every pretty URL
 * (/@handle/<folder>/<id>-<title>). Renameable here, and safely: every URL
 * resolves by FILE ID, so links already shared keep working and simply heal
 * to the new handle. Saying so on the card is the point — otherwise a rename
 * feels like it might break things, and nobody touches it.
 */
import { useState } from 'react';
import { Button, Input, MicroLabel, PANEL } from '@/components/ui';

const REFUSALS: Record<string, string> = {
  username_taken: 'that handle is taken — pick another',
  invalid_username: '3–32 characters: lowercase letters, numbers, underscore (no hyphens)',
};

export default function UsernameCard({ username }: { username: string | null }) {
  const [value, setValue] = useState(username ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/my/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: value }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setStatus('could not reach the server');
    const body = (await res.json().catch(() => ({}))) as { username?: string; error?: string };
    if (res.ok && body.username) {
      // Show what the server STORED (it lowercases and trims), not what was typed.
      setValue(body.username);
      setStatus('saved');
      return;
    }
    setStatus(REFUSALS[body.error ?? ''] ?? 'could not save that handle');
  };

  return (
    <section className={`${PANEL} p-4`}>
      <MicroLabel>handle</MicroLabel>
      {/* One line: @ + name + save. The handle is PUBLIC — plain Input, never
       * TokenInput (its password masking turned the name into dots, and its
       * w-full pushed the @ and the button onto their own lines). */}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        {/* Fixed w-4 gutter + gap-2 = 24px, which is exactly the ml-6 every
         * line below carries: the card reads as one column under the field. */}
        <span className="w-4 text-center font-mono text-sm text-muted">@</span>
        <span className="min-w-0 flex-1 sm:max-w-72">
          <Input
            aria-label="Username"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </span>
        <Button type="submit" aria-label="Save username" disabled={busy || !value.trim()}>
          save
        </Button>
      </form>
      <p className="mt-2 ml-6 font-mono text-[11px] text-faint">
        your documents live at <span className="text-muted">/@{value || 'handle'}/…</span>
      </p>
      <p className="mt-1 ml-6 font-mono text-xs leading-relaxed text-muted">
        Renaming is safe: links already shared keep working — every URL resolves by the
        document&apos;s id and corrects itself to the new handle.
      </p>
      {status && (
        <p role="status" className={`mt-2 ml-6 font-mono text-xs ${status === 'saved' ? 'text-accent' : 'text-danger'}`}>
          {status}
        </p>
      )}
    </section>
  );
}
