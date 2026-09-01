'use client';

/**
 * A PANEL ANCHORED TO A TRIGGER, PORTALLED OUT OF WHATEVER BOX THE TRIGGER
 * SITS IN — and, on a phone, a bottom sheet instead.
 *
 * It is portalled for the reason SelectMenu gives for its own: an absolutely
 * placed panel is clipped by ANY `overflow-hidden`/`auto` ancestor, and z-index
 * does not escape a clip. That is not hypothetical here. The editor toolbar's
 * left group is a scroller so the controls can slide on a phone while `done`
 * stays put (InPlaceEditor), and `overflow-x: auto` makes the OTHER axis `auto`
 * with it — turning that group into a ~26px-tall clip box in both directions.
 * The theme grid and the mode list opened `absolute top-full`, straight into
 * it: a real bounding box, two grid columns, no page overflow, nothing painted,
 * and every click falling through to the document iframe underneath. Every
 * geometry check the mobile gate already ran passed throughout, which is why
 * the hit test now sits beside them.
 *
 * The phone decision lives HERE, not in the caller. It was duplicated state in
 * both of ThemePicker's popovers (`sheet`, re-seeded from `isPhoneViewport()`
 * on every click) — a detail neither of them exists to know. A caller now owns
 * exactly one thing, `open`; this owns where the panel goes, how it is placed
 * and how it is dismissed.
 *
 * Deliberately NOT a listbox: SelectMenu keeps that (option roles, arrow keys,
 * the check mark), because it always models "one value out of a closed set".
 * This is the plain container underneath — a group of whatever the caller draws.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import { Tooltip } from '@/components/Tooltip';

export interface AnchoredPanelProps {
  /** Accessible name of the PANEL (and the sheet's dialog label on a phone). */
  label: string;
  open: boolean;
  /** Dismissal is REPORTED, never taken: the caller stays the one holding `open`. */
  onOpenChange: (open: boolean) => void;
  /**
   * The control the panel hangs off, rendered in place. It needs no click
   * handler of its own — opening, closing and re-click-to-close are this
   * component's, which is what stops a press on the trigger being read as a
   * press outside (dismiss, then reopen, so the panel could never be put away).
   */
  trigger: React.ReactElement;
  /**
   * Tip on the trigger, if it wants one — taken here rather than applied by the
   * caller because the NESTING ORDER is not obvious and gets it wrong silently.
   * Tooltip hands its own slot to its child, so a Tooltip BETWEEN the popover
   * trigger and the button swallows the props that open the panel: the tip
   * still worked, the chip simply stopped opening. Outside, they chain.
   */
  tooltip?: React.ReactNode;
  /** Sheet only — a title row that stays put while the body scrolls. */
  sheetHeader?: React.ReactNode;
  /**
   * LAYOUT of the panel body — the surface (border, ground, shadow) is ours.
   * It is applied in BOTH homes, which is why it is written responsively: the
   * sheet only ever exists below `sm`, so `grid-cols-1 sm:grid-cols-2` is one
   * column on a phone and two on the desktop popover without either caller
   * forking on a viewport it should not know about.
   */
  className?: string;
  children: React.ReactNode;
}

export default function AnchoredPanel({
  label, open, onOpenChange, trigger, tooltip, sheetHeader, className = '', children,
}: AnchoredPanelProps) {
  const phone = useIsPhoneViewport();

  return (
    <>
      {/* On a phone the sheet below is the panel, so Radix is told it is shut —
          its trigger stays mounted and keeps anchoring nothing. */}
      <PopoverPrimitive.Root open={open && !phone} onOpenChange={onOpenChange}>
        {tooltip ? (
          <Tooltip content={tooltip}>
            <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
          </Tooltip>
        ) : (
          <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
        )}
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            role="group"
            aria-label={label}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            // The panel is chrome over a document someone is reading, and the
            // trigger keeps the keyboard — as it did before it was portalled.
            onOpenAutoFocus={(e) => e.preventDefault()}
            // Above every app layer: portalled to <body> it inherits no stacking
            // context, so it has to outrank the highest surface that can hold a
            // trigger — the centered dialogs at z-[100]. SelectMenu's rank.
            className={`z-[200] rounded-[6px] border border-edge bg-surface p-2 shadow-lg ${className}`}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {/* The phone half. It portals to <body> too, and owns its own dismissal.
          It brings its own surface, so only the LAYOUT travels here. */}
      {open && phone && (
        <MobileSheet label={label} onClose={() => onOpenChange(false)} header={sheetHeader}>
          <div className={className}>{children}</div>
        </MobileSheet>
      )}
    </>
  );
}
