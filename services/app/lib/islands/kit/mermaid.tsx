/* @jsxImportSource solid-js */
import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { mermaidImageKey, mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import { useIsland } from '../context';
import type { MermaidImage } from '@/components/kit/mermaid-render';
import type { Drawn } from '@/lib/mermaid-images/reader-draw';

/**
 * Today's React Mermaid (components/kit/mermaid), ported: a stored drawing (the island's `drawings`)
 * is served and only its bytes are checked; otherwise the reader draws it in the document's theme
 * (lib/mermaid-images/reader-draw: palette resolved to hex, fonts waited for) and marks the figure with
 * what it was drawn under, for the harvest. `ready` only once the image has loaded; a theme change on
 * an ancestor redraws.
 */
type Props = { code: string; title?: string; colorMode?: 'light' | 'dark'; imageKey?: string; className?: string; inGridItem?: boolean; [key: string]: unknown };
const join = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
/** The prose image's inline style as React's server renderer writes `{ width, maxWidth: '100%', height: 'auto' }`. */
const servedStyle = (image: MermaidImage) => `${image.width !== undefined ? `width:${image.width}px;` : ''}max-width:100%;height:auto`;

export function Mermaid(p: Props) {
  const island = useIsland();
  const [result, setResult] = createSignal<Drawn | null>(null);
  const [loadedSrc, setLoadedSrc] = createSignal<string>();
  // A stored drawing this reader cannot use (its bytes would not load): the engine draws instead.
  const [refused, setRefused] = createSignal<string>();
  // Hydration must start from the compiled prop, then move to the reader's current mode on mount:
  // Solid only patches the server's image when the signal changes. SSR itself uses the request mode.
  const [activeMode, setActiveMode] = createSignal<'light' | 'dark'>(typeof window === 'undefined'
    ? island.colorMode?.() ?? p.colorMode ?? 'light' : p.colorMode ?? 'light', { equals: false });
  let host!: HTMLElement;
  let img: HTMLImageElement | undefined;
  const invalid = () => mermaidSourceError(p.code);
  const mode = activeMode;
  const imageKey = () => p.imageKey && mode() === p.colorMode ? p.imageKey : mermaidImageKey(p.code, mode());
  const stored = () => { const offered = island.drawings()[imageKey()]; return offered && offered.src !== refused() ? offered : undefined; };
  const storedSrc = () => stored()?.src;
  const current = () => { const r = result(); return r?.code === p.code ? r : null; };
  const error = () => invalid() || current()?.error;
  const image = (): MermaidImage | undefined => current()?.image ?? stored();
  const src = () => image()?.src;
  const engineDrawn = () => !!current()?.image && !!current()?.palette;
  onMount(() => {
    setActiveMode(host.ownerDocument.documentElement.classList.contains('dark') ? 'dark' : 'light');
    // A stored image needs no engine. Its later theme changes use a lazy observer outside the
    // ready-time kit closure; it rechecks the current mode when loaded, covering that gap.
    const controller = new AbortController();
    void import('./mermaid-mode').then(m => m.observeMermaidMode(host, setActiveMode, controller.signal));
    onCleanup(() => controller.abort());
    createEffect(on([() => p.code, mode, invalid, storedSrc], ([code, colorMode, bad, servedSrc]) => {
      if (bad) return;
      setResult(null);
      if (servedSrc) return;
      // A stored drawing never loads the scheduler, drawing helpers, or Mermaid.
      const controller = new AbortController();
      void import('./mermaid-draw').then(m => m.startMermaidDraw(host, code, colorMode === 'dark', controller.signal, setResult),
        () => { if (!controller.signal.aborted) setResult({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); });
      onCleanup(() => controller.abort());
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
  const onLoad = () => setLoadedSrc(src());
  const onError = () => {
    const source = src();
    if (source === storedSrc()) setRefused(source);
    else setResult({ code: p.code, error: 'Could not display this diagram.' });
  };

  const { code, title, colorMode, imageKey: _imageKey, className, inGridItem: _inGrid, ...rest } = p; void code; void colorMode;
  const name = () => title ?? 'Diagram';
  // A served (stored) drawing's style, as an attribute: React's server string, left alone while hydrating.
  const imgAttrs = (): JSX.ImgHTMLAttributes<HTMLImageElement> => ({ 'attr:style': !p.inGridItem && image() && !current()?.image ? servedStyle(image()!) : undefined } as JSX.ImgHTMLAttributes<HTMLImageElement>);
  return <figure ref={host} class={join('min-w-0', p.inGridItem ? 'flex h-full w-full flex-col' : 'my-4', className)}
    data-mx-mermaid-state={error() ? 'error' : image() && loadedSrc() === image()!.src ? 'ready' : 'pending'} data-mermaid-type={image()?.type}
    data-m={mode()}
    data-mx-mermaid-key={engineDrawn() ? imageKey() : undefined} data-mx-mermaid-palette={engineDrawn() ? current()?.palette : undefined}
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
