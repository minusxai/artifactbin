import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

/** Tailwind's `sm` threshold, by innerWidth (jsdom implements no media queries). */
export const isPhoneViewport = (): boolean => typeof window !== 'undefined' && window.innerWidth < 640;

/** The same answer, LIVE. */
export function createIsPhoneViewport(): Accessor<boolean> {
  const [phone, setPhone] = createSignal(isPhoneViewport());
  onMount(() => {
    const onResize = () => setPhone(isPhoneViewport());
    onResize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });
  return phone;
}
