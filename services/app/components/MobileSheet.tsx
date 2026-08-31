'use client';

/**
 * THE BOTTOM SHEET A PHONE GETS WHERE DESKTOP GETS AN ANCHORED POPOVER.
 *
 * One primitive, because a second hand-rolled panel is how two surfaces start
 * disagreeing about focus and dismissal (the RowMenu lesson). The CALLER
 * decides when it is used — it owns the desktop alternative and mounts this
 * instead on a phone — and the sheet owns everything a sheet is: the backdrop,
 * Escape, the slide-up, the grab handle, the scroll cap.
 *
 * It PORTALS to <body>: these panels live inside the top bar, whose
 * `backdrop-blur` makes it the containing block for fixed descendants (the
 * documented menu bug) — rendered in place, `bottom-0` would anchor the sheet
 * to the BAR's bottom edge, hanging it just under the chrome.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tailwind's `sm` threshold, by innerWidth rather than matchMedia: readable in
 * any environment (jsdom implements no media queries) and trivially settable
 * by a test. ONE spelling of "is this a phone", shared by every caller.
 */
export const isPhoneViewport = () =>
  typeof window !== 'undefined' && window.innerWidth < 640;

/** The same answer, LIVE: for chrome that must move when the window crosses
    the threshold (the bottom action bar), not just re-decide on the next
    click the way the sheets do. */
export function useIsPhoneViewport() {
  const [phone, setPhone] = useState(isPhoneViewport);
  useEffect(() => {
    const onResize = () => setPhone(isPhoneViewport());
    // A server render (the pages helper, a prerender) has no window and said
    // false — correct once on mount, then follow the window.
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return phone;
}

export default function MobileSheet({ label, onClose, size = 'tall', header, children }: {
  label: string;
  onClose: () => void;
  /** `half` caps the sheet at half the screen — for a panel ABOUT the
      document (comments), where seeing the subject beside it is the point.
      `tall` (80vh) is for panels that replace the page's attention (sharing,
      themes). */
  size?: 'tall' | 'half';
  /** Rides ABOVE the scrolling body — a title row and its close control must
      stay reachable however far the list below has scrolled. */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* A half sheet gets NO scrim at all: the subject must stay readable AND
          scrollable beside the panel — a scrim, even transparent, swallows the
          touches that would scroll it. It closes by its own X or Escape. */}
      {size !== 'half' && (
        <button
          type="button"
          aria-label="Close sheet"
          onClick={onClose}
          className="fixed inset-0 z-40 cursor-default border-0 bg-black/40 p-0"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`fixed inset-x-0 bottom-0 z-50 ${size === 'half' ? 'max-h-[50vh]' : 'max-h-[80vh]'} flex animate-[sheet-in_.2s_ease-out] flex-col rounded-t-[10px] border-t border-edge bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-mono text-xs shadow-lg`}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-edge" />
        {header && <div className="shrink-0">{header}</div>}
        {/* The body is the ONLY scroller — the handle and header stay put. */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>,
    document.body,
  );
}
