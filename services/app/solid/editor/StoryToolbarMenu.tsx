/* @jsxImportSource solid-js */
/**
 * Editor menus that escape the scrolling
 * toolbar (solid/ui/Popover, the framework-free Radix popper placement) while staying
 * reachable: pointer actions preserve the document range (onMouseDown prevented on the trigger), and
 * the panel does not steal focus on open.
 */
import type { JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Button } from '@/solid/ui/Button';
import { Popover } from '@/solid/ui/Popover';

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
      class="max-w-[calc(100vw-16px)] p-2 text-fg"
      sideOffset={6}
      trigger={(attrs) => (
        <Button
          ref={attrs.ref}
          variant="ghost"
          size="sm"
          aria-label={name()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onOpenChange(!props.open)}
          class="gap-1.5"
        >
          <span class={props.hint ? 'underline decoration-dotted underline-offset-4' : undefined}>{props.label}</span>
          <ChevronDown size={12} />
        </Button>
      )}
    >
      {props.children}
    </Popover>
  );
}
