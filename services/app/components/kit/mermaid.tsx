import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from './cn';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import type { MermaidImage, MermaidPalette } from './mermaid-render';

export interface MermaidProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  code: string;
  title?: string;
  colorMode?: 'light' | 'dark';
}

/** Resolve modern CSS colors to RGB; Mermaid's color math expects hex colors. */
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
  return {
    dark, background: color('--background', dark ? '#111827' : '#ffffff'),
    foreground: color('--foreground', dark ? '#f9fafb' : '#111827'),
    primary: color('--primary', '#2563eb'), border: color('--border', '#9ca3af'),
  };
}

export function Mermaid({ code, title = 'Diagram', colorMode = 'light', className, ...props }: MermaidProps) {
  const host = useRef<HTMLElement>(null);
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
  return <figure {...props} ref={host} className={cn('my-4 min-w-0', className)} data-mx-mermaid-state={error ? 'error' : current?.loaded ? 'ready' : 'pending'} data-mermaid-type={current?.image?.type}>
    <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : current?.image ?
      <img width={current.image.width} height={current.image.height} style={{ width: current.image.width, maxWidth: '100%', height: 'auto' }} src={current.image.src} alt={title} className="block h-auto max-w-full" onLoad={() => setResult(value => value && value.image === current.image ? { ...value, loaded: true } : value)} onError={() => setResult({ code, error: 'Could not display this diagram.' })} /> :
      <p role="status" className="text-sm text-muted-foreground">Rendering diagram…</p>}
    <details className="mt-2 text-xs text-muted-foreground"><summary>Diagram source</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{typeof code === 'string' ? code : ''}</pre></details>
  </figure>;
}
