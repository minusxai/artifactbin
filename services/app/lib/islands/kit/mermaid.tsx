/* @jsxImportSource solid-js */
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { mermaidImageKey, mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import { useIsland } from '../context';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';

type Drawing = StoredMermaidImage & { svg?: string };
type Props = { code: string; title?: string; colorMode?: 'light' | 'dark'; imageKey?: string; className?: string; [key: string]: unknown };
export function Mermaid(p: Props) {
  const island = useIsland(); const [drawn,setDrawn] = createSignal<Drawing | null>(null); const [error,setError] = createSignal<string | null>(null);
  const stored = () => island.drawings()[p.imageKey ?? mermaidImageKey(p.code,p.colorMode ?? 'light')] as Drawing | undefined;
  const image = () => stored() ?? drawn(); const invalid = () => mermaidSourceError(p.code); let host!: HTMLElement;
  onMount(() => createEffect(() => {
    if (invalid() || stored()) return;
    let live = true;
    const style = getComputedStyle(host);
    const color = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
    // Intentional lazy engine boundary: a stored drawing never loads Mermaid.
    void import('@/components/kit/mermaid-render').then(m => m.renderMermaid(p.code, {
      dark: p.colorMode === 'dark', background: color('--background','#ffffff'), foreground: color('--foreground','#111827'),
      primary: color('--primary','#2563eb'), border: color('--border','#9ca3af'), card: color('--card','#ffffff'),
      muted: color('--muted','#f3f4f6'), accent: color('--accent','#f3f4f6'), mutedForeground: color('--muted-foreground','#6b7280'),
      fontFamily: style.fontFamily || 'system-ui, sans-serif', fontMono: color('--font-mono','ui-monospace, Menlo, monospace'), fontSize: '14px',
    })).then(result => { if (live) setDrawn({ ...result, palette: '' }); }, () => { if (live) setError('Could not render this diagram. Check its Mermaid syntax.'); });
    onCleanup(() => { live = false; });
  }));
  const { code,title,colorMode,imageKey,className,...rest } = p; void code; void colorMode; void imageKey;
  return <figure ref={host} class={['min-w-0','my-4',className].filter(Boolean).join(' ')} data-mx-mermaid-state={invalid() || error() ? 'error' : image() ? 'ready' : 'pending'} data-mermaid-type={image()?.type} {...rest}>
    <figcaption class="mb-2 font-mono text-sm font-medium">{title ?? 'Diagram'}</figcaption>
    <Show when={invalid() || error()} fallback={<Show when={image()} fallback={<p role="status" class="text-sm text-muted-foreground">Rendering diagram…</p>}>
      <Show when={image()?.svg} fallback={<img src={image()?.src} width={image()?.width} height={image()?.height} alt={title ?? 'Diagram'} class="block h-auto max-w-full" />}>
        <span innerHTML={image()!.svg!} /></Show></Show>}>
      <p role="alert" class="text-sm text-destructive">{invalid() || error()}</p>
    </Show>
  </figure>;
}
