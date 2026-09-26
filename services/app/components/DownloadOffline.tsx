'use client';
/**
 * "Download for offline": the page's door to `/a/<id>/download`, the one
 * self-contained `.html` a reader can open, edit and comment on without a
 * connection. Who may have it is the route's rule (the same as viewing); this
 * control only asks for it and saves it.
 *
 * It stays a real link (`href` + `download`) so it reads as what it is, but a
 * click fetches first: the route refuses a document too large for one file
 * with a 413 and a reason, and a bare download link would save that refusal as
 * the file. So the bytes are saved only when they are the file, and otherwise
 * the route's reason is shown where the link was pressed.
 *
 * Imports nothing from the offline file itself: the reader bundle must not
 * carry the offline runtime to offer a link to it.
 */
import { Download } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { Tooltip } from '@/components/Tooltip';

export const DOWNLOAD_OFFLINE_TIP = 'One HTML file you can open, edit and comment on without a connection.';

/** The offline file's address: the head, or the archived version the page is showing. */
export const offlineFileHref = (id: string, version?: number) =>
  `/a/${id}/download${version !== undefined ? `?version=${version}` : ''}`;

/** The saved name the route chose (RFC 6266 `filename*` first), else a plain fallback. */
function savedName(disposition: string | null): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded.trim()); } catch { /* fall through */ } }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? 'artifact.html';
}

async function refusal(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === 'string' && body.message
    ? body.message
    : `The offline file could not be made (HTTP ${response.status}).`;
}

export default function DownloadOffline({ id, version, className, onSaved }: {
  id: string;
  /** The archived version on screen; omitted for the head. */
  version?: number;
  className?: string;
  /** After the file was handed to the browser to save (e.g. to close the menu). */
  onSaved?: () => void;
}) {
  const href = offlineFileHref(id, version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok) { setError(await refusal(response)); return; }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = savedName(response.headers.get('Content-Disposition'));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // The click has handed the blob to the download; release it on the next turn.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      onSaved?.();
    } catch {
      setError('The offline file could not be downloaded. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip content={DOWNLOAD_OFFLINE_TIP} positioning={{ placement: 'left' }}>
        <a
          href={href}
          download
          aria-label="Download for offline"
          aria-busy={busy || undefined}
          onClick={event => { void save(event); }}
          className={className}
        >
          <Download size={14} strokeWidth={1.75} />
          {busy ? 'preparing file…' : 'download for offline'}
        </a>
      </Tooltip>
      {error && <p role="alert" className="px-2 py-1 font-mono text-xs text-danger">{error}</p>}
    </>
  );
}
