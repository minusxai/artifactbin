/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import { personFaceBackground, personInitial } from '@/lib/islands/person-face';

/** Decorative identity face shared with the Solid app and reader chrome. */
export function Avatar(props: { image: string | null; initial: string; userId: string; size?: number }): JSX.Element {
  const [failed, setFailed] = createSignal<string | null>(null);
  /** An image URL this face may paint: web, same-origin or an inline data image; nothing else reaches the src. */
  const image = (): string | null => (props.image && /^(https?:\/\/|\/|data:image\/)/.test(props.image) ? props.image : null);
  return <span aria-hidden="true" style={{ width: props.size ? `${props.size}px` : '100%', height: props.size ? `${props.size}px` : '100%' }} class="relative block shrink-0 overflow-hidden rounded-full">
    <span data-face-initial="" style={{ 'background-color': personFaceBackground(props.userId), 'font-size': props.size ? `${Math.round(props.size * 0.42)}px` : undefined }} class="flex size-full items-center justify-center font-semibold leading-none text-white">{personInitial(props.initial)}</span>
    <Show when={image() && failed() !== image()}><img src={image()!} alt="" onError={() => setFailed(image())} class="absolute inset-0 size-full object-cover" /></Show>
  </span>;
}
