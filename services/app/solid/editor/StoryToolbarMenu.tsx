/* @jsxImportSource solid-js */
/**
 * components/views/story/StoryToolbarMenu.tsx in SOLID — editor menus that escape the scrolling
 * toolbar (solid/components/Popover, the framework-free Radix popper placement) while staying
 * reachable: pointer actions preserve the document range (onMouseDown prevented on the trigger), and
 * the panel does not steal focus on open.
 */
import type { JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Popover } from '@/solid/components/Popover';

export function StoryToolbarMenu(props: {
  label: string;
  name?: string;
  /** A quiet "this wants attention" state (an image with no alt text): muted, dashed, never loud. */
  hint?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}): JSX.Element {
  const name = () => props.name ?? props.label;
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      label={`${name()} options`}
      class="z-[200] max-w-[calc(100vw-16px)] rounded-lg p-2 text-fg"
      sideOffset={6}
      trigger={(attrs) => (
        <button
          ref={attrs.ref}
          type="button"
          aria-label={name()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onOpenChange(!props.open)}
          class={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-normal leading-none hover:bg-surface ${
            props.hint ? 'text-muted underline decoration-dotted underline-offset-4 hover:text-fg' : 'text-fg'
          }`}
        >
          {props.label}
          <ChevronDown size={12} />
        </button>
      )}
    >
      {props.children}
    </Popover>
  );
}
