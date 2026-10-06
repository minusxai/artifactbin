/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { LoaderCircle, UserRound } from 'lucide-solid';
import { DEFAULT_UPLOAD_MAX_BYTES } from '@artifactbin/contracts';
import { pageDataChanged, profileChanged } from '@/web/page-data-events';
import { Avatar } from './Avatar';
import { Button } from './ui';

const REFUSALS: Record<string, string> = {
  unsupported_image: 'that file is not a picture this can use — PNG, JPEG, WebP, GIF or AVIF',
  image_too_large: `that picture is over ${DEFAULT_UPLOAD_MAX_BYTES / 1_000_000} MB — pick a smaller one`,
  image_unreadable: 'that picture could not be read — try exporting it again',
};
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export function AvatarCircle(props: { image: string | null; initial: string; userId: string; compact?: boolean; onChange: (image: string | null) => void; onRemove?: () => void }): JSX.Element {
  let picker!: HTMLInputElement;
  const [answer, setAnswer] = createSignal<{ image: string | null; over: string | null } | null>(null);
  const [pending, setPending] = createSignal<'upload' | 'remove' | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  createEffect(() => { if (answer() && answer()!.over !== props.image) setAnswer(null); });
  const image = () => answer()?.over === props.image ? answer()!.image : props.image;
  const pick = () => { if (!pending()) picker.click(); };
  const send = async (action: 'upload' | 'remove', init: RequestInit) => {
    setPending(action); setStatus(null);
    const response = await fetch('/api/my/profile/image', { credentials: 'same-origin', ...init }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { image?: string | null; error?: string } : null;
    setPending(null);
    if (!response || !body) { setStatus('could not reach the server'); return; }
    if (!response.ok) { setStatus(REFUSALS[body.error ?? ''] ?? 'could not save that picture'); return; }
    const next = action === 'upload' ? body.image ?? null : null;
    setAnswer({ image: next, over: props.image });
    pageDataChanged(); profileChanged();
    if (action === 'remove' && props.onRemove) props.onRemove(); else props.onChange(next);
  };
  return <div>
    <div class="flex flex-col items-center gap-3 text-center min-[400px]:flex-row min-[400px]:gap-5 min-[400px]:text-left">
      <div data-avatar-circle="" aria-hidden="true" tabIndex={-1} onClick={pick} class={`relative flex ${props.compact ? 'size-16' : 'size-24'} shrink-0 items-center justify-center overflow-hidden rounded-full text-muted ${pending() ? '' : 'cursor-pointer'} ${image() ? 'border border-edge' : 'border border-edge-bright bg-raised hover:border-muted'}`}>
        <Show when={image()} fallback={<Show when={pending() !== 'upload'}><UserRound class="size-10" strokeWidth={1.5} /></Show>}><Avatar image={image()} initial={props.initial} userId={props.userId} /></Show>
        <Show when={pending() === 'upload'}><span class={`absolute inset-0 flex items-center justify-center ${image() ? 'bg-black/55 text-white' : ''}`}><LoaderCircle class="size-8 animate-spin" /></span></Show>
      </div>
      <div class="min-w-0"><div class="flex flex-wrap justify-center gap-2 min-[400px]:justify-start">
        <Button type="button" aria-busy={pending() === 'upload'} disabled={!!pending()} onClick={pick}>{pending() === 'upload' ? 'Uploading…' : image() ? 'Change photo' : 'Upload a photo'}</Button>
        <Show when={image() && props.onRemove}><Button variant="ghost" type="button" aria-label="Remove photo" disabled={!!pending()} onClick={() => void send('remove', { method: 'DELETE' })}>Remove photo</Button></Show>
      </div><Show when={status()}><p role="status" class="mt-2 text-xs text-danger">{status()}</p></Show></div>
    </div>
    <input ref={picker} type="file" accept={AVATAR_ACCEPT} class="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void send('upload', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); event.currentTarget.value = ''; }} />
  </div>;
}
