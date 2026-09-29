/* @jsxImportSource solid-js */
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { Tooltip } from './Tooltip';

const SIZES = { sm: { box: 'px-2.5 py-2', text: 'text-[11px]', icon: 12 }, lg: { box: 'px-3.5 py-3', text: 'text-[13px] sm:text-[15px]', icon: 15 } } as const;
export function CopyBlock(props: { text: string; label: string; trailer?: string; size?: keyof typeof SIZES; class?: string }): JSX.Element {
  const scale = () => SIZES[props.size ?? 'sm'];
  const [copied, setCopied] = createSignal(false);
  let timer = 0;
  onCleanup(() => clearTimeout(timer));
  const copy = async () => { try { await navigator.clipboard.writeText(props.text); setCopied(true); clearTimeout(timer); timer = window.setTimeout(() => setCopied(false), 1600); } catch { /* text stays selectable */ } };
  return <div class={`${props.class ?? 'mt-3'} ${scale().box} flex items-start gap-2 rounded-[4px] border border-code-edge bg-code`}><pre class={`min-w-0 flex-1 font-mono ${scale().text} leading-relaxed break-words whitespace-pre-wrap text-fg`}>{props.text}<Show when={props.trailer}><span class="text-muted">{'\n'}{props.trailer}</span></Show></pre><Tooltip content={copied() ? 'copied!' : 'copy'}><button type="button" onClick={() => void copy()} aria-label={props.label} class="mt-[2px] shrink-0 cursor-pointer text-muted hover:text-fg"><Show when={copied()} fallback={<Copy size={scale().icon} />}><Check size={scale().icon} class="text-accent" /></Show></button></Tooltip></div>;
}
