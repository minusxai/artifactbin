'use client';

/**
 * THE PROFILE-PICTURE UPLOADER — the welcome page's first row and the top of
 * the account page, one component so those two screens never drift into two
 * different pictures of the same thing.
 *
 * NO PICTURE LOOKS EMPTY. A person without one sees a dashed, empty circle and
 * a labelled "Upload a photo" button, never the generated initial: a coloured
 * letter here reads as "picture already set", and people skipped it. Everywhere
 * ELSE (app bar, profile header, comments) keeps the initial through
 * `components/Avatar`, so people without pictures still look distinct.
 *
 * THE BUTTON IS THE CONTROL. It carries the name ("Upload a photo" / "Change
 * photo"), takes the focus and opens the picker on Enter/Space. The circle is a
 * larger pointer shortcut to the same picker and nothing more: hidden from the
 * accessibility tree and out of the tab order, so there are never two controls
 * answering to one name.
 *
 * With a picture, the circle draws it through `components/Avatar` — the same
 * face the app bar uses, initial beneath, so a picture whose address fails
 * never leaves a broken-image glyph.
 *
 * The bytes go straight to `PUT /api/my/profile/image` as the file's own type;
 * the server re-encodes and answers with the new address, which is swapped in
 * place. Every refusal it can make is a sentence here, because "400" on a
 * profile page is not something a person can act on — and a refusal leaves
 * whatever was showing before exactly as it was.
 */
import { useRef, useState } from 'react';
import { LoaderCircle, Upload, UserRound } from 'lucide-react';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import Avatar from '@/components/Avatar';
import { pageDataChanged, profileChanged } from '@/web/page-data-events';

const MAX_MB = DEFAULT_UPLOAD_MAX_BYTES / 1_000_000;

/** The three refusals `lib/avatars` makes, as sentences. */
const REFUSALS: Record<string, string> = {
  unsupported_image: 'that file is not a picture this can use — PNG, JPEG, WebP, GIF or AVIF',
  image_too_large: `that picture is over ${MAX_MB} MB — pick a smaller one`,
  image_unreadable: 'that picture could not be read — try exporting it again',
};

/** What the file picker offers; the same set the server accepts, and no SVG. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/** The kit's button shape (`components/ui` Button), in the two weights this needs. */
const BUTTON = 'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-3 py-1.5 font-mono text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const SOLID = `${BUTTON} border-fg bg-fg text-bg hover:opacity-90`;
const OUTLINED = `${BUTTON} border-edge-bright bg-transparent hover:border-accent hover:text-accent`;

export default function AvatarCircle({ image: given, initial, userId, onChange, onRemove }: {
  /** The picture's address, or null for the empty uploader. */
  image: string | null;
  /** The name whose initial `Avatar` keeps beneath a picture, in case its address fails. */
  initial: string;
  /** Whose picture: the colour behind that fallback initial comes from this. */
  userId: string;
  /** The new address (or null), once the server has taken it. */
  onChange: (image: string | null) => void;
  /**
   * When given, a "Remove" button is offered beside "Change photo", and this is
   * what a successful removal reports to instead of `onChange(null)` — one call
   * per action, so a page that offers removal never handles it twice. The
   * DELETE itself stays here: a page opts into the affordance, not into the door.
   */
  onRemove?: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  /*
   * THE SERVER'S LAST ANSWER, and the `image` it arrived over. A page that
   * re-fetches instead of handing the address straight back (the account page)
   * still passes the OLD image until its data lands; showing that would flash
   * "Upload a photo" right after an upload. The answer stands only while the
   * page's prop is unchanged — the moment the page says anything new, it wins.
   */
  const [answer, setAnswer] = useState<{ image: string | null; over: string | null } | null>(null);
  // Dropped (during render, React's derive-from-props pattern) as soon as the prop moves.
  if (answer && answer.over !== given) setAnswer(null);
  const image = answer && answer.over === given ? answer.image : given;
  // WHICH request is in flight, not a flag: only an upload is "Uploading…".
  const [pending, setPending] = useState<'upload' | 'remove' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const busy = pending !== null;
  const uploading = pending === 'upload';

  /**
   * One request, and everything its answer changes IN ORDER: the answer is
   * recorded and busy cleared together, BEFORE the page is told anything. The
   * page-data events can re-render the page synchronously, and doing them first
   * drew one frame of the old state ("Upload a photo") right after an upload.
   */
  const send = async (action: 'upload' | 'remove', init: RequestInit): Promise<{ image: string | null } | null> => {
    setPending(action);
    setStatus(null);
    const res = await fetch('/api/my/profile/image', { credentials: 'same-origin', ...init }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { image?: string | null; error?: string }) : null;
    if (!res || !body) { setPending(null); setStatus('could not reach the server'); return null; }
    if (!res.ok) { setPending(null); setStatus(REFUSALS[body.error ?? ''] ?? 'could not save that picture'); return null; }
    const image = action === 'upload' ? body.image ?? null : null;
    setAnswer({ image, over: given });
    setPending(null);
    // Anything that draws this person elsewhere is now stale — the app bar's
    // face included, which is the session's to re-read.
    pageDataChanged();
    profileChanged();
    return { image };
  };

  const upload = async (file: File) => {
    // The FILE's type, not a guess: the server sniffs the bytes anyway, and a
    // header it can read is one less thing for it to refuse.
    const body = await send('upload', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (body) onChange(body.image);
  };

  const remove = async () => {
    const body = await send('remove', { method: 'DELETE' });
    if (!body) return;
    if (onRemove) onRemove(); else onChange(null);
  };

  const pick = () => { if (!busy) picker.current?.click(); };

  return (
    <div>
      {/* Circle left, controls right; stacked and centred on a narrow phone. */}
      <div className="flex flex-col items-center gap-3 text-center min-[400px]:flex-row min-[400px]:gap-5 min-[400px]:text-left">
        {/*
          * A pointer shortcut to the same picker, NOT a second control: the
          * button beside it is the one with the name and the focus.
          */}
        <div
          data-avatar-circle=""
          aria-hidden="true"
          tabIndex={-1}
          onClick={pick}
          className={`relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full text-muted ${
            busy ? '' : 'cursor-pointer'
          } ${image ? 'border border-edge' : 'border-2 border-dashed border-edge-bright bg-raised hover:border-muted'}`}
        >
          {image ? <Avatar image={image} initial={initial} userId={userId} /> : !uploading && <UserRound className="size-10" strokeWidth={1.5} />}
          {uploading && (
            <span className={`absolute inset-0 flex items-center justify-center ${image ? 'bg-black/55 text-white' : ''}`}>
              <LoaderCircle className="size-8 animate-spin" />
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap justify-center gap-2 min-[400px]:justify-start">
            <button
              type="button"
              aria-busy={uploading}
              disabled={busy}
              onClick={pick}
              className={image ? `${OUTLINED} text-fg` : SOLID}
            >
              {uploading
                ? 'Uploading…'
                : image
                  ? 'Change photo'
                  : <><Upload aria-hidden="true" className="size-3.5" />Upload a photo</>}
            </button>
            {onRemove && image && (
              <button
                type="button"
                // The visible word, plus what it removes: "Remove" alone is ambiguous
                // among the account page's other controls.
                aria-label="Remove photo"
                onClick={() => void remove()}
                disabled={busy}
                className={`${OUTLINED} text-muted`}
              >
                Remove
              </button>
            )}
          </div>
          {/* Held together so a narrow column wraps at the dot, not inside "50 MB". */}
          {!image && <p className="mt-2 text-xs text-muted">PNG, JPEG, WebP, GIF or AVIF <span className="whitespace-nowrap">· up to {MAX_MB} MB</span></p>}
        </div>
      </div>
      {status && <p role="status" className="mt-3 text-center font-mono text-xs text-danger min-[400px]:text-left">{status}</p>}
      {/*
        * Hidden from everyone, including the accessibility tree: the BUTTON is
        * the control and carries the name.
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
    </div>
  );
}
