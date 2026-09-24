/**
 * The sharing dialog's FRAME — the part that must exist the instant someone
 * asks to share, before the sharing code itself has arrived.
 *
 * ShareLink (the dialog's content: visibility, people, dataset writes) is an
 * on-demand chunk: owners and editors are the only people who open it, and a
 * reader of the document must not download it (lib/__tests__/reader-bundle-hygiene).
 * If the button is pressed before that chunk lands, ShareLinkOnDemand draws
 * THIS frame at once, busy, and the real dialog replaces it in the same place.
 * Both draw the same frame, so nothing moves when the content arrives.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createLucideIcon, X } from 'lucide-react';
import { useTrustedPortalContainer } from '@/components/TrustedUi';
import { VISIBILITY_ICON_NODES } from '@/lib/visibility-icons';

export const VISIBILITY_ICONS = {
  shared: createLucideIcon('users', VISIBILITY_ICON_NODES.shared),
  public: createLucideIcon('globe', VISIBILITY_ICON_NODES.public),
  unlisted: createLucideIcon('eye-off', VISIBILITY_ICON_NODES.unlisted),
  private: createLucideIcon('lock', VISIBILITY_ICON_NODES.private),
} as const;

/** The dialog's heading: the displayed name of what is being shared. */
export const shareTitle = (title: string | null | undefined, format: string | undefined): string =>
  `Share “${title ?? (format === 'folder' ? 'Untitled folder' : 'Untitled')}”`;

/** One viewport-level sharing surface. Portaling keeps it centered even when
 * its trigger lives inside an animated controls popover. */
export function SharePanel({ onClose, children, title, busy = false, embedded = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The content is still downloading (ShareLinkOnDemand). */
  busy?: boolean;
  /** Editor workspace surface, without modal behavior. */
  embedded?: boolean;
}) {
  const portal = useTrustedPortalContainer();
  useEffect(() => {
    if (embedded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', escape);
    };
  }, [onClose, embedded]);

  if (embedded) return <section aria-label="Sharing settings" className="w-full max-w-2xl font-mono text-xs">
    <h2 className="mb-2 break-words text-base font-semibold text-fg">{title}</h2>
    <p className="mb-6 text-muted">Manage access, invite people, or copy the link.</p>
    {children}
  </section>;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button
        type="button"
        aria-label="Close sharing by clicking outside"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/45 p-0 backdrop-blur-[2px]"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Sharing"
        aria-busy={busy || undefined}
        className="relative z-10 flex w-full max-w-2xl animate-[rise_.16s_ease-out] flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface font-mono text-xs shadow-2xl"
        style={{ maxHeight: 'calc(100svh - 24px)' }}
      >
        <header className="flex items-start gap-4 border-b border-edge px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-base font-semibold text-fg">{title}</h2>
            <p className="mt-1 text-[11px] text-faint">Manage access, invite people, or copy the link.</p>
          </div>
          <button
            type="button"
            aria-label="Close sharing"
            autoFocus
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>
        <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </section>
    </div>,
    portal ?? document.body,
  );
}
