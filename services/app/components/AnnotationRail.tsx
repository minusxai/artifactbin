/**
 * The comment rail's FRAME, apart from the comment layer itself.
 *
 * The layer (components/AnnotationLayer) is an on-demand chunk — only people
 * who may comment ever mount it, and a reader must not download it
 * (lib/__tests__/reader-bundle-hygiene). If someone opens comments before that
 * chunk lands, AnnotationLayerOnDemand draws THIS frame at once, busy, and the
 * layer draws the same frame when it arrives, so the rail does not move.
 */
import { createPortal } from 'react-dom';
import MobileSheet from '@/components/MobileSheet';
import { RIGHT_RAIL_W } from '@/lib/story/edit-bar';

/**
 * The conversation's two homes: the fixed right rail on
 * desktop — the page narrows the document by its width — and a bottom sheet
 * on a phone. The content between them is identical; this wrapper is the only
 * thing that knows the difference.
 */
export function RailChrome({ phone, host, topOffset, rightInset, onClose, header, children, busy = false }: {
  phone: boolean;
  /** The editor's panel, when it hosts the rail: rendered into it, not as a column of its own. */
  host?: HTMLElement;
  topOffset: number;
  rightInset: number;
  onClose: () => void;
  /** The title row + close control — pinned above the scroll in BOTH homes:
      the way out must stay reachable however long the list gets. */
  header: React.ReactNode;
  children: React.ReactNode;
  /** The layer's code is still downloading (AnnotationLayerOnDemand). */
  busy?: boolean;
}) {
  const ariaBusy = busy || undefined;
  if (phone) {
    return (
      <MobileSheet label="Annotation sidebar" onClose={onClose} size="half" header={header}>
        <div aria-busy={ariaBusy} className="flex flex-col gap-2.5">{children}</div>
      </MobileSheet>
    );
  }
  if (host) {
    return createPortal(
      <section data-capture-chrome aria-label="Annotation sidebar" aria-busy={ariaBusy} className="flex min-h-0 flex-1 flex-col gap-2.5 bg-bg p-2.5">
        <div className="shrink-0">{header}</div>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{children}</div>
      </section>,
      host,
    );
  }
  return (
    <aside
      data-capture-chrome aria-label="Annotation sidebar" aria-busy={ariaBusy}
      className="fixed bottom-0 z-20 flex flex-col gap-2.5 border-l border-edge bg-bg p-2.5"
      style={{ top: topOffset, right: rightInset, width: RIGHT_RAIL_W }}
    >
      <div className="shrink-0">{header}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{children}</div>
    </aside>
  );
}
