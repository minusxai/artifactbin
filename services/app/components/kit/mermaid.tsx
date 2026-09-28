import { createContext, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from './cn';
import { GridItemContext } from './grid';
import { mermaidImageKey, mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';
import type { MermaidImage } from './mermaid-render';
import { drawForReader, type ReaderDrawing } from '@/lib/mermaid-images/reader-draw';

interface MermaidProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  code: string;
  title?: string;
  colorMode?: 'light' | 'dark';
}

/**
 * The document's PRERENDERED drawings (StoryIslandData.mermaidImages), keyed by
 * `mermaidImageKey(code, mode)`. Provided around everything a document draws —
 * the deck rail re-renders each slide's nodes — and empty wherever nothing was
 * stored: an editor's draft, an offline file, a document the harvest has not
 * reached. Empty means exactly today's path: the engine draws.
 */
const MermaidImagesContext = createContext<Readonly<Record<string, StoredMermaidImage>>>({});
export const MermaidImagesProvider = MermaidImagesContext.Provider;

/** A reader's engine drawing, or why it failed (lib/mermaid-images/reader-draw draws and marks it). */
type Drawn = { code: string; error?: string } & Partial<ReaderDrawing>;

export function Mermaid({ code, title = 'Diagram', colorMode = 'light', className, ...props }: MermaidProps) {
  const host = useRef<HTMLElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Inside a grid cell the tile owns the size: the figure fills it and the
  // drawing scales to fit; in prose the drawing keeps its own layout size.
  const inGridItem = useContext(GridItemContext);
  const images = useContext(MermaidImagesContext);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Drawn | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // A stored drawing this reader cannot use (another palette, or its bytes
  // would not load): the engine draws instead, as it would with none stored.
  const [refused, setRefused] = useState<string | null>(null);
  const invalid = mermaidSourceError(code);
  const imageKey = useMemo(() => (invalid ? null : mermaidImageKey(code, colorMode)), [code, colorMode, invalid]);
  const offered = imageKey ? images[imageKey] : undefined;
  const stored = offered && offered.src !== refused ? offered : undefined;
  const storedSrc = stored?.src ?? null;
  useEffect(() => {
    // Only a CHANGED value redraws: the reader's adopted story is re-stamped with
    // the theme it already has (lib/story-runtime/InlineStoryRuntime), and each
    // such write used to draw every diagram again.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.oldValue !== (record.target as Element).getAttribute(record.attributeName ?? ''))) setRevision(n => n + 1);
    });
    for (let element = host.current?.parentElement; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] });
    }
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (invalid || !host.current) return;
    let active = true;
    const element = host.current;
    // Mermaid lays labels out by measuring them, so the reader's drawing waits for the palette's own
    // faces and is marked with what it was drawn under only when the fonts held still
    // (lib/mermaid-images/reader-draw, shared with the compiled reader's Solid Mermaid).
    const draw = () => {
      void drawForReader(element, code, colorMode === 'dark', () => active).then(
        (drawn) => { if (active && drawn) setResult({ code, ...drawn }); },
        () => { if (active) setResult({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); },
      );
    };
    // A stored drawing is already on screen (the server rendered it), and it is
    // the drawing as it is on every platform: its layout fixed, its fonts inside
    // it (lib/mermaid-images/fonts). Nothing of this browser's decides it, so
    // nothing is measured or waited for; only bytes that will not load bring
    // the engine in (below).
    setResult(null);
    if (!storedSrc) draw();
    return () => { active = false; };
  }, [code, colorMode, invalid, revision, storedSrc]);
  const current = result?.code === code ? result : null;
  const error = invalid || current?.error;
  const image: MermaidImage | undefined = current?.image ?? stored;
  const src = image?.src ?? null;
  // An image that finished (or failed) before hydration fired its event into
  // nothing: read the element's own state once it is ours.
  useEffect(() => {
    const element = img.current;
    if (!element || !src || !element.complete) return;
    if (element.naturalWidth > 0) setLoadedSrc(src);
    else if (src === storedSrc) setRefused(src);
  }, [src, storedSrc]);
  const onLoad = () => { if (src) setLoadedSrc(src); };
  const onError = () => {
    if (src && src === storedSrc) setRefused(src);
    else setResult({ code, error: 'Could not display this diagram.' });
  };
  const engineDrawn = !!current?.image && !!current.palette;
  // The source is not shown here: in edit mode the diagram inspector holds it.
  return <figure {...props} ref={host} className={cn('min-w-0', inGridItem ? 'flex h-full w-full flex-col' : 'my-4', className)}
    data-mx-mermaid-state={error ? 'error' : image && loadedSrc === image.src ? 'ready' : 'pending'} data-mermaid-type={image?.type}
    // What the engine drew here, and under which palette — read by the harvest
    // (lib/mermaid-images) to store it. Client-only: the server never draws.
    data-mx-mermaid-key={engineDrawn && imageKey ? imageKey : undefined} data-mx-mermaid-palette={engineDrawn ? current?.palette : undefined}
    data-mx-mermaid-metrics={engineDrawn ? current?.metrics : undefined} data-mx-mermaid-portable={engineDrawn && current?.portable ? '' : undefined}
    data-mx-mermaid-faces={engineDrawn ? current?.faces : undefined}>
    {/* In a tile the title is chart chrome, like a Question's; in prose it is a caption. */}
    <figcaption className={inGridItem ? 'border-b border-border px-3 py-2 font-mono text-sm font-medium' : 'mb-2 font-mono text-sm font-medium'}>{title}</figcaption>
    {error ? <p role="alert" className={cn('text-sm text-destructive', inGridItem && 'p-3')}>{error}</p> : image ?
      inGridItem
        ? <img ref={img} width={image.width} height={image.height} src={image.src} alt={title} className="min-h-0 w-full flex-1 object-contain p-3" onLoad={onLoad} onError={onError} />
        : <img ref={img} width={image.width} height={image.height} style={{ width: image.width, maxWidth: '100%', height: 'auto' }} src={image.src} alt={title} className="block h-auto max-w-full" onLoad={onLoad} onError={onError} /> :
      <p role="status" className={cn('text-sm text-muted-foreground', inGridItem && 'p-3')}>Rendering diagram…</p>}
  </figure>;
}
