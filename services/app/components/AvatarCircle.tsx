'use client';

/**
 * THE PROFILE PICTURE, AS A CONTROL.
 *
 * One circle that is both the picture and the way to change it, so there is no
 * separate "upload" affordance to find: the circle IS the button, hovering or
 * focusing it says `edit`, and clicking opens the file picker. The same
 * component is the whole of the welcome page's first row and the top of the
 * account page, which is what keeps those two screens from drifting into two
 * different pictures of the same thing.
 *
 * NOBODY EVER SEES A BROKEN IMAGE. A person with no picture gets a generated
 * initial on a colour derived from their id — stable, so it is recognisably
 * theirs, and computed rather than stored, so a person who never uploads
 * anything costs nothing. The drawing itself is `components/Avatar`, the same
 * one the app bar's menu button uses.
 *
 * The bytes go straight to `PUT /api/my/profile/image` as the file's own type;
 * the server re-encodes and answers with the new address, which is swapped in
 * place. Every refusal it can make is a sentence here, because "400" on a
 * profile page is not something a person can act on.
 */
import { useRef, useState } from 'react';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import Avatar from '@/components/Avatar';
import { pageDataChanged, profileChanged } from '@/web/page-data-events';

/** The three refusals `lib/avatars` makes, as sentences. */
const REFUSALS: Record<string, string> = {
  unsupported_image: 'that file is not a picture this can use — PNG, JPEG, WebP, GIF or AVIF',
  image_too_large: `that picture is over ${DEFAULT_UPLOAD_MAX_BYTES / 1_000_000} MB — pick a smaller one`,
  image_unreadable: 'that picture could not be read — try exporting it again',
};

/** What the file picker offers; the same set the server accepts, and no SVG. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export default function AvatarCircle({ image, initial, userId, onChange, onRemove }: {
  /** The picture's address, or null for the generated initial. */
  image: string | null;
  /** The letter to draw when there is no picture — the handle's first. */
  initial: string;
  /** Whose picture: the colour behind the initial comes from this. */
  userId: string;
  /** The new address (or null), once the server has taken it. */
  onChange: (image: string | null) => void;
  /**
   * When given, a "Remove picture" button is offered beneath, and this is what
   * a successful removal reports to instead of `onChange(null)` — one call per
   * action, so a page that offers removal never handles it twice. The DELETE
   * itself stays here: a page opts into the affordance, not into the door.
   */
  onRemove?: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = async (init: RequestInit): Promise<{ image?: string | null; error?: string } | null> => {
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/my/profile/image', { credentials: 'same-origin', ...init }).catch(() => null);
    setBusy(false);
    if (!res) { setStatus('could not reach the server'); return null; }
    const body = (await res.json().catch(() => ({}))) as { image?: string | null; error?: string };
    if (!res.ok) { setStatus(REFUSALS[body.error ?? ''] ?? 'could not save that picture'); return null; }
    // Anything that draws this person elsewhere is now stale — the app bar's
    // face included, which is the session's to re-read.
    pageDataChanged();
    profileChanged();
    return body;
  };

  const upload = async (file: File) => {
    // The FILE's type, not a guess: the server sniffs the bytes anyway, and a
    // header it can read is one less thing for it to refuse.
    const body = await send({ method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (body) onChange(body.image ?? null);
  };

  const remove = async () => {
    const body = await send({ method: 'DELETE' });
    if (!body) return;
    if (onRemove) onRemove(); else onChange(null);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-label="Change picture"
        aria-busy={busy}
        disabled={busy}
        onClick={() => picker.current?.click()}
        className="group relative size-24 overflow-hidden rounded-full border border-edge focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar image={image} initial={initial} userId={userId} />
        {/* Presentation only: the button already has its name. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-black/55 font-mono text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {busy ? 'saving…' : 'edit'}
        </span>
      </button>
      {/*
        * Hidden from everyone, including the accessibility tree: the BUTTON is
        * the control and carries the name. Two elements answering to "Change
        * picture" would be two controls to a screen reader and an ambiguous
        * match to a test.
        */}
      <input
        ref={picker}
        type="file"
        accept={AVATAR_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the SAME file twice still fires a change.
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {onRemove && image && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="font-mono text-xs text-muted underline-offset-4 hover:underline"
        >
          Remove picture
        </button>
      )}
      {status && <p role="status" className="font-mono text-xs text-danger">{status}</p>}
    </div>
  );
}
