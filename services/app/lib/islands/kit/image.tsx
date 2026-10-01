/* @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { boundImageValue, imageReferenceId } from '@/lib/story/assets/image-source';
import { useIsland } from '../context';

/** A reader-chosen image source goes through this document's scoped import door. */
export function BoundImage(p: { template: string; props: Record<string, string>; row?: Record<string, unknown> }) {
  const island = useIsland();
  const source = createMemo(() => {
    const value = boundImageValue(p.template, island.values(), p.row);
    return typeof value === 'string' && value ? value : null;
  });
  const [mapped, setMapped] = createSignal<{ source: string; url: string } | null>(null);
  const [refused, setRefused] = createSignal<string | null>(null);
  const imported = new Map<string, string>();
  createEffect(() => {
    const value = source();
    if (!value || typeof document === 'undefined') return;
    const id = imageReferenceId(value);
    if (p.row && id) { setMapped({ source: value, url: `/a/${id}/raw` }); setRefused(null); return; }
    const cached = imported.get(value);
    if (cached) { setMapped({ source: value, url: cached }); setRefused(null); return; }
    if (!id && !/^https?:\/\//i.test(value)) { setRefused(value); return; }
    const controller = new AbortController();
    void import('./image-map').then(({ mapImage }) => mapImage(value, !!p.row, island.assetsUrl(), imported, controller.signal))
      .then(url => { if (!controller.signal.aborted) { if (url) { setMapped({ source: value, url }); setRefused(null); } else setRefused(value); } })
      .catch(() => { if (!controller.signal.aborted) setRefused(value); });
    onCleanup(() => controller.abort());
  });
  // SSR paints through the scoped door immediately; the browser maps new selections after hydration.
  const servedUrl = () => {
    if (typeof document !== 'undefined') return undefined;
    const value = source(), door = island.assetsUrl();
    if (!value) return undefined;
    const id = p.row && imageReferenceId(value);
    if (id) return `/a/${id}/raw`;
    return door && (imageReferenceId(value) || /^https?:\/\//i.test(value))
      ? `${door}${door.includes('?') ? '&' : '?'}u=${encodeURIComponent(value)}` : undefined;
  };
  const url = () => mapped()?.source === source() ? mapped()?.url : servedUrl();
  return <img {...p.props} src={url()}
    data-mx-bound={url() ? undefined : `src:${p.template}`}
    data-mx-asset={refused() === source() ? 'refused' : undefined} />;
}
