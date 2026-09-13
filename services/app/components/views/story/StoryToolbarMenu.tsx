'use client';

import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTrustedPortalContainer } from '@/components/TrustedUi';

/** Editor menus escape the scrolling toolbar while staying in trusted UI.
 * Pointer actions preserve the document range; keyboard users can Tab into
 * the panel. Inputs inside the panel retain their normal focus behavior.
 */
export function StoryToolbarMenu({
  label,
  name = label,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  name?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const container = useTrustedPortalContainer();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={name}
          onMouseDown={(event) => event.preventDefault()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-fg hover:bg-surface"
        >
          {label}
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          aria-label={`${name} options`}
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onMouseDown={(event) => {
            // Action buttons preserve the text range, but URL inputs must focus.
            if ((event.target as HTMLElement).closest('button')) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-[200] max-w-[calc(100vw-16px)] rounded-lg border border-edge bg-surface p-2 text-fg shadow-lg"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
