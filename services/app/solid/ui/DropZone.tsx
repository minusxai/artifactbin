/* @jsxImportSource solid-js */
/**
 * THE FILE DROP TARGET: a dashed, full-width button that takes a dropped file, or opens the file picker when
 * pressed (click, Enter or Space — it is a real button), through a hidden file input that is never a Tab stop.
 * Named by `label`, described by `hint`; `title` is its visible line. `onFiles` gets the chosen files (the first
 * only, unless `multiple`); the picker's value is reset so the same file can be chosen again.
 */
import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import { FOCUS_RING } from './control-styles';

const HEIGHT = { md: 'min-h-56', sm: 'min-h-28' } as const;

export function DropZone(props: {
  label: string;
  title: JSX.Element;
  hint?: JSX.Element;
  icon?: () => JSX.Element;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  size?: keyof typeof HEIGHT;
  onFiles: (files: File[]) => void;
  class?: string;
}): JSX.Element {
  let input!: HTMLInputElement;
  const hint = createUniqueId();
  const [dragging, setDragging] = createSignal(false);
  const take = (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length || props.disabled) return;
    props.onFiles(props.multiple ? files : files.slice(0, 1));
  };
  return <>
    <button type="button" aria-label={props.label} aria-describedby={props.hint ? hint : undefined} disabled={props.disabled}
      data-dragging={dragging() ? 'true' : undefined}
      onClick={() => input.click()}
      onDragOver={(event) => { event.preventDefault(); if (!props.disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); take(event.dataTransfer?.files); }}
      class={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border border-dashed px-4 py-6 text-center font-sans transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50 ${HEIGHT[props.size ?? 'md']} ${dragging() ? 'border-accent bg-accent-soft' : 'border-edge-bright bg-raised/40 enabled:hover:border-accent'} ${props.class ?? ''}`}>
      <Show when={props.icon}>{(icon) => <span aria-hidden="true" class="text-accent">{icon()()}</span>}</Show>
      <span class="text-base font-medium text-fg">{props.title}</span>
      <Show when={props.hint}><span id={hint} class="text-sm text-muted">{props.hint}</span></Show>
    </button>
    <input ref={input} type="file" accept={props.accept} multiple={props.multiple} tabIndex={-1} aria-hidden="true" class="sr-only" disabled={props.disabled}
      onChange={(event) => { const files = event.currentTarget.files; take(files ? [...files] : null); event.currentTarget.value = ''; }} />
  </>;
}
