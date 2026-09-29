/* @jsxImportSource solid-js */
import type { JSX } from 'solid-js';
import { videoWatchUrl } from '@/lib/story-ui/video-embed';
import { fileNameFromUrl, formatFileSize } from '@/lib/file-display';

type P = JSX.HTMLAttributes<HTMLDivElement>;
function PlayBadge() { return <div data-slot="video-play" aria-hidden="true" class="flex h-14 w-20 items-center justify-center rounded-xl bg-[#FF0000]"><div class="ml-1 h-0 w-0 border-y-[12px] border-l-[20px] border-y-transparent border-l-white" /></div>; }
export function Video(props: P & { src?: string; poster?: string; title?: string; interactive?: boolean }) {
  const { src, poster, title, interactive = true, ...rest } = props;
  const url = videoWatchUrl(src);
  if (!url) return <div data-slot="video" {...rest}><span aria-label="Video unavailable">video unavailable — unsupported source</span></div>;
  const thumb = poster && !poster.startsWith('ref:') ? poster : null;
  return <div data-slot="video" {...rest}>{thumb ? <><img data-slot="video-thumb" src={thumb} alt="" aria-hidden="true" class="absolute inset-0 h-full w-full object-cover" /><div aria-hidden="true" class="absolute inset-0 flex items-center justify-center"><PlayBadge /></div></> : <div data-slot="video-poster" aria-hidden="true" class="absolute inset-0 flex items-center justify-center bg-neutral-900"><PlayBadge /></div>}{interactive ? <a data-slot="video-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={title ? `Play video: ${title}` : 'Play video'} class="absolute inset-0" /> : null}</div>;
}
function FileGlyph() { return <svg data-slot="file-glyph" aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 opacity-70"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>; }
export function File(props: P & { src?: string; title?: string; name?: string; bytes?: string | number; pages?: string | number; interactive?: boolean }) {
  const { src, title, name, bytes, pages, interactive = true, ...rest } = props;
  const resolved = typeof src === 'string' && src !== '' && !src.startsWith('ref:') ? src : null;
  const label = title ?? name ?? fileNameFromUrl(resolved) ?? 'File';
  const size = Number(bytes), count = Number(pages);
  const facts = ['PDF', Number.isFinite(size) && size > 0 ? formatFileSize(size) : null, Number.isFinite(count) && count > 0 ? `${count} page${count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  return <div data-slot="file" {...rest}><FileGlyph /><div class="min-w-0 flex-1"><div data-slot="file-name" class="truncate font-medium">{resolved && interactive ? <a data-slot="file-link" href={resolved} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`} class="underline underline-offset-2">{label}</a> : label}</div><div data-slot="file-meta" class="text-sm text-muted-foreground">{resolved ? facts : 'file unavailable — the file this card names is gone'}</div></div></div>;
}
