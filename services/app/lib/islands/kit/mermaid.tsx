/* @jsxImportSource solid-js */
import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { mermaidImageKey, mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import { useIsland } from '../context';
import { STORY_ROOT_SELECTOR } from '../contract';
import { deferEngine } from '../defer-engine';
import type { MermaidImage } from '@/lib/mermaid-images/mermaid-render';
import type { Drawn } from '@/lib/mermaid-images/reader-draw';

/**
 * The retired React Mermaid, ported: a stored drawing (the island's `drawings`)
 * is served and only its bytes are checked; otherwise the reader draws it in the document's theme
 * (lib/mermaid-images/reader-draw: palette resolved to hex, fonts waited for) and marks the figure with
 * what it was drawn under, for the harvest. `ready` only once the image has loaded; a theme change on
 * an ancestor redraws.
 */
type Props = { code: string; title?: string; colorMode?: 'light' | 'dark'; imageKey?: string; className?: string; inGridItem?: boolean; [key: string]: unknown };
const join = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
/** The prose image's inline style as React's server renderer writes `{ width, maxWidth: '100%', height: 'auto' }`. */
const servedStyle = (image: MermaidImage) => [image.width !== undefined ? `width:${image.width}px` : '', 'max-width:100%', 'height:auto'].filter(Boolean).join(';');
/** Set by @mx/page before this island's module runs; a capture has no page override. */
const pageMode = (): 'light' | 'dark' | null => typeof document === 'undefined'
  ? null : document.documentElement.getAttribute('data-mx-reader-mode') as 'light' | 'dark' | null;

export function Mermaid(p: Props) {
  const island = useIsland();
  const [result, setResult] = createSignal<Drawn | null>(null);
  const [loadedSrc, setLoadedSrc] = createSignal<string | null>(null);
  // A stored drawing this reader cannot use (its bytes would not load): the engine draws instead.
  const [refused, setRefused] = createSignal<string | null>(null);
  const [revision, setRevision] = createSignal(0);
  const invalid = () => mermaidSourceError(p.code);
  const liveMode = () => {
    revision();
    const themed = host?.closest(STORY_ROOT_SELECTOR) ?? host?.closest('.dark, .light');
    const modeRoot = themed ?? (typeof document !== 'undefined' ? document.documentElement : null);
    const mode = modeRoot?.classList.contains('dark') ? 'dark' : modeRoot?.classList.contains('light') ? 'light' : p.colorMode ?? 'light';
    if (host?.isConnected && mode === pageMode()) document.documentElement.removeAttribute('data-mx-reader-mode');
    return mode;
  };
  const imageKey = () => {
    if (invalid()) return null;
    const mode = liveMode();
    const override = pageMode();
    return p.imageKey ?? mermaidImageKey(p.code, override ?? mode);
  };
  const stored = () => { const key = imageKey(); const offered = key ? island.drawings()[key] : undefined; return offered && offered.src !== refused() ? offered : undefined; };
  const storedSrc = () => stored()?.src ?? null;
  const current = () => { const r = result(); return r?.code === p.code ? r : null; };
  const error = () => invalid() || current()?.error;
  const image = (): MermaidImage | undefined => current()?.image ?? stored();
  const src = () => image()?.src ?? null;
  const engineDrawn = () => !!current()?.image && !!current()?.palette;
  let host!: HTMLElement; let img: HTMLImageElement | undefined;

  onMount(() => {
    let disposed = false;
    let stopMode = () => {};
    const modeAtMount = liveMode();
    // The late watcher compares the mode it finds with this first sample before deciding to resample.
    void import('./theme-watch').then(({ watchThemeMode }) => {
      if (!disposed) stopMode = watchThemeMode(host, () => setRevision(n => n + 1), () => liveMode() !== modeAtMount);
    });
    onCleanup(() => { disposed = true; stopMode(); });
    // JSX evaluates the stored-image key before its figure ref is assigned.
    // Resample once with the mounted host, so an initial dark page does not keep the light drawing.
    setRevision(n => n + 1);
    // Solid hydration adopts the server's <img> without writing an initially different src.
    // A reader mode carried in window.name can make that server image the wrong variant.
    createEffect(on(src, source => {
      if (img && source && img.getAttribute('src') !== source) {
        setLoadedSrc(null);
        img.setAttribute('src', source);
      }
    }));
    createEffect(on([() => p.code, liveMode, invalid, revision, storedSrc], ([code, mode, bad, , servedSrc]) => {
      if (bad) return;
      // The page module may apply a same-tab colour override after this island mounts.
      // Avoid priming Mermaid's module with the old palette before that class flip.
      const override = pageMode();
      if (override && mode !== override) return;
      let live = true;
      setResult(null);
      if (servedSrc) return;
      // Intentional lazy boundary: a stored drawing never loads the drawing helpers or Mermaid.
      const cancel = deferEngine(host, () => { void import('@/lib/mermaid-images/reader-draw').then(m => m.drawForReader(host, code, mode === 'dark', () => live)).then(
        drawn => { if (live && drawn) setResult({ code, ...drawn }); },
        () => { if (live) setResult({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); },
      ); });
      onCleanup(() => { live = false; cancel(); });
    }));
    // An image that finished (or failed) before hydration fired its event into nothing: read its own state.
    createEffect(on([src, storedSrc], ([source, servedSrc]) => {
      if (!img || !source || !img.complete) return;
      if (img.naturalWidth > 0) setLoadedSrc(source);
      else if (source === servedSrc) setRefused(source);
    }));
    // An image drawn HERE gets its inline style through the CSSOM, as React writes a client-rendered one.
    createEffect(on(() => current()?.image, drawn => {
      if (!img || !drawn || p.inGridItem) return;
      if (drawn.width !== undefined) img.style.width = `${drawn.width}px`;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }));
  });
  const onLoad = () => { const source = src(); if (source) setLoadedSrc(source); };
  const onError = () => {
    const source = src();
    if (source && source === storedSrc()) setRefused(source);
    else setResult({ code: p.code, error: 'Could not display this diagram.' });
  };

  const { code, title, colorMode, imageKey: _imageKey, className, inGridItem: _inGrid, ...rest } = p; void code; void colorMode;
  const name = () => title ?? 'Diagram';
  // A served (stored) drawing's style, as an attribute: React's server string, left alone while hydrating.
  const imgAttrs = (): JSX.ImgHTMLAttributes<HTMLImageElement> => ({ 'attr:style': !p.inGridItem && image() && !current()?.image ? servedStyle(image()!) : undefined } as JSX.ImgHTMLAttributes<HTMLImageElement>);
  return <figure ref={host} class={join('min-w-0', p.inGridItem ? 'flex h-full w-full flex-col' : 'my-4', className)}
    data-mx-mermaid-state={error() ? 'error' : image() && loadedSrc() === image()!.src ? 'ready' : 'pending'} data-mermaid-type={image()?.type}
    data-mx-mermaid-key={engineDrawn() ? imageKey() ?? undefined : undefined} data-mx-mermaid-palette={engineDrawn() ? current()?.palette : undefined}
    data-mx-mermaid-metrics={engineDrawn() ? current()?.metrics : undefined} data-mx-mermaid-portable={engineDrawn() && current()?.portable ? '' : undefined}
    data-mx-mermaid-faces={engineDrawn() ? current()?.faces : undefined} {...rest}>
    <figcaption class={p.inGridItem ? 'border-b border-border px-3 py-2 font-mono text-sm font-medium' : 'mb-2 font-mono text-sm font-medium'}>{name()}</figcaption>
    <Show when={!error()} fallback={<p role="alert" class={join('text-sm text-destructive', p.inGridItem && 'p-3')}>{error()}</p>}>
      <Show when={image()} fallback={<p role="status" class={join('text-sm text-muted-foreground', p.inGridItem && 'p-3')}>Rendering diagram…</p>}>
        <img ref={img} width={image()?.width} height={image()?.height} {...imgAttrs()} src={image()?.src} alt={name()}
          class={p.inGridItem ? 'min-h-0 w-full flex-1 object-contain p-3' : 'block h-auto max-w-full'} on:load={onLoad} on:error={onError} />
      </Show>
    </Show>
  </figure>;
}
