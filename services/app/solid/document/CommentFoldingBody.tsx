/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { foldFromMeasure } from '@/lib/annotations/comment-folds';
import { CommentMarkdown } from './CommentMarkdown';

/** The rail measures rendered markdown and clamps only bodies over ten laid-out lines. */
export function CommentFoldingBody(props: { text: string; foldable: boolean }): JSX.Element {
  let measured!: HTMLDivElement;
  const [fold, setFold] = createSignal({ overflowing: false, lines: 0, maxHeight: 0 });
  const [shown, setShown] = createSignal(false);
  createEffect(() => {
    void props.text;
    queueMicrotask(() => {
      if (!measured?.isConnected) return;
      const line = measured.querySelector('p, li, pre') ?? measured;
      const height = Number.parseFloat(getComputedStyle(line).lineHeight) || 20;
      const next = foldFromMeasure(measured.scrollHeight, height);
      setFold(current => current.overflowing === next.overflowing && current.lines === next.lines && current.maxHeight === next.maxHeight ? current : next);
    });
  });
  const clamped = () => props.foldable && fold().overflowing && !shown();
  return <div class="min-w-0"><div data-folded-body={clamped() ? 'clamped' : undefined} class={clamped() ? 'overflow-hidden' : undefined} style={clamped() ? { 'max-height': `${fold().maxHeight}px` } : undefined}>
    <div ref={measured}><CommentMarkdown text={props.text} /></div>
  </div><Show when={props.foldable && fold().overflowing}><button type="button" aria-label={clamped() ? 'Show whole comment' : 'Show less of comment'} aria-expanded={!clamped()} onClick={() => setShown(value => !value)} class="mt-1 font-mono text-[10px] text-muted">{clamped() ? `show more (${fold().lines} lines)` : 'show less'}</button></Show></div>;
}
