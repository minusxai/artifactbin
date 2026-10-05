/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import type { StorySystem } from '@/lib/data/story/story-systems';

/** Generated covers preserve each system's typography without loading its fonts into the app. */
export default function DesignSystemSpecimen(props: { system: StorySystem; colorMode?: 'light' | 'dark' | null; selected?: boolean }): JSX.Element {
  const mode = () => resolveStoryMode(props.system.name, props.colorMode);
  return <span data-design-specimen={props.system.name} aria-hidden="true" class="relative block">
    <img src={`/design-systems/${props.system.name}${mode() === 'dark' ? '-dark' : ''}.webp`}
      alt="" width={480} height={436} loading="lazy" decoding="async" class="block h-auto w-full" />
    <Show when={props.selected}><span class="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-accent text-white shadow-sm"><Check size={12} /></span></Show>
  </span>;
}
