import { useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from './cn';
import { GridItemContext } from './grid';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import type { MermaidImage, MermaidPalette } from './mermaid-render';

export interface MermaidProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  code: string;
  title?: string;
  colorMode?: 'light' | 'dark';
}

/**
 * The document's theme as Mermaid needs it: tokens resolved to hex (its colour
 * math expects hex, and modern CSS colours would not parse), plus the type the
 * host element already renders in.
 */
function paletteFor(element: HTMLElement, dark: boolean): MermaidPalette {
  const style = getComputedStyle(element);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const color = (name: string, fallback: string) => {
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = style.getPropertyValue(name).trim() || fallback;
    ctx.fillRect(0, 0, 1, 1);
    return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const size = Number.parseFloat(style.fontSize);
  // Labels sit between apparatus and body text: never below 12px, never above 16px.
  const labelPx = Number.isFinite(size) && size > 0 ? Math.round(Math.min(Math.max(size, 12), 16)) : 14;
  return {
    dark, background: color('--background', dark ? '#111827' : '#ffffff'),
    foreground: color('--foreground', dark ? '#f9fafb' : '#111827'),
    primary: color('--primary', '#2563eb'), border: color('--border', '#9ca3af'),
    card: color('--card', dark ? '#1f2937' : '#ffffff'),
    muted: color('--muted', dark ? '#1f2937' : '#f3f4f6'),
    mutedForeground: color('--muted-foreground', dark ? '#9ca3af' : '#6b7280'),
    // The theme's own face as the browser resolved it here; a web font the
    // reader's machine lacks falls through the stack, as it does everywhere else.
    fontFamily: style.fontFamily.trim() || 'system-ui, sans-serif',
    fontMono: style.getPropertyValue('--font-mono').trim() || 'ui-monospace, Menlo, monospace',
    fontSize: labelPx + 'px',
  };
}

export function Mermaid({ code, title = 'Diagram', colorMode = 'light', className, ...props }: MermaidProps) {
  const host = useRef<HTMLElement>(null);
  // Inside a grid cell the tile owns the size: the figure fills it and the
  // drawing scales to fit; in prose the drawing keeps its own layout size.
  const inGridItem = useContext(GridItemContext);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ code: string; image?: MermaidImage; error?: string; loaded?: boolean } | null>(null);
  const invalid = mermaidSourceError(code);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision(n => n + 1));
    for (let element = host.current?.parentElement; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] });
    }
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (invalid || !host.current) return;
    let active = true;
    setResult(null);
    const palette = paletteFor(host.current, colorMode === 'dark');
    // Intentional engine split: Mermaid is large and browser-only.
    void import('./mermaid-render').then(engine => engine.renderMermaid(code, palette)).then(
      image => { if (active) setResult({ code, image }); },
      () => { if (active) setResult({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); },
    );
    return () => { active = false; };
  }, [code, colorMode, invalid, revision]);
  const current = result?.code === code ? result : null;
  const error = invalid || current?.error;
  const image = current?.image;
  const onLoad = () => setResult(value => value && value.image === image ? { ...value, loaded: true } : value);
  const onError = () => setResult({ code, error: 'Could not display this diagram.' });
  // The source is not shown here: in edit mode the diagram inspector holds it.
  return <figure {...props} ref={host} className={cn('min-w-0', inGridItem ? 'flex h-full w-full flex-col' : 'my-4', className)} data-mx-mermaid-state={error ? 'error' : current?.loaded ? 'ready' : 'pending'} data-mermaid-type={image?.type}>
    {/* In a tile the title is chart chrome, like a Question's; in prose it is a caption. */}
    <figcaption className={inGridItem ? 'border-b border-border px-3 py-2 font-mono text-sm font-medium' : 'mb-2 font-mono text-sm font-medium'}>{title}</figcaption>
    {error ? <p role="alert" className={cn('text-sm text-destructive', inGridItem && 'p-3')}>{error}</p> : image ?
      inGridItem
        ? <img width={image.width} height={image.height} src={image.src} alt={title} className="min-h-0 w-full flex-1 object-contain p-3" onLoad={onLoad} onError={onError} />
        : <img width={image.width} height={image.height} style={{ width: image.width, maxWidth: '100%', height: 'auto' }} src={image.src} alt={title} className="block h-auto max-w-full" onLoad={onLoad} onError={onError} /> :
      <p role="status" className={cn('text-sm text-muted-foreground', inGridItem && 'p-3')}>Rendering diagram…</p>}
  </figure>;
}
