/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import Download from 'lucide-solid/icons/download';
import { Tooltip } from '../ui/Tooltip';

export function DownloadOffline(props: { id: string; version?: number }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const href = () => `/a/${encodeURIComponent(props.id)}/download${props.version === undefined ? '' : `?version=${props.version}`}`;
  const save = async (event: MouseEvent) => {
    event.preventDefault(); if (busy()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(href(), { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        setError(body?.message ?? `The offline file could not be made (HTTP ${response.status}).`); return;
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = blobUrl;
      const disposition = response.headers.get('Content-Disposition');
      const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      try { link.download = encoded ? decodeURIComponent(encoded.trim()) : disposition?.match(/filename="([^"]+)"/i)?.[1] ?? 'artifact.html'; }
      catch { link.download = 'artifact.html'; }
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch { setError('The offline file could not be downloaded. Check the connection and try again.'); }
    finally { setBusy(false); }
  };
  return <><Tooltip content="One HTML file you can open, edit and comment on without a connection."><a href={href()} download="" aria-label="Download for offline" aria-busy={busy() ? 'true' : undefined} onClick={event => void save(event)} class="flex w-full items-center gap-2 rounded px-2 py-2 font-mono text-xs text-muted hover:bg-raised"><Download size={14} />{busy() ? 'preparing file…' : 'download for offline'}</a></Tooltip><Show when={error()}><p role="alert" class="text-xs text-danger">{error()}</p></Show></>;
}
