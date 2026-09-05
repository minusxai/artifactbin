'use client';

/**
 * THE OVERFLOW MENU BEHIND A ROW'S "…".
 *
 * Extracted because it is now needed twice — the dense tier's rows (move,
 * delete) and a shelf's ASSET rows (delete) — and a second hand-rolled
 * popover is how two menus start disagreeing about focus, dismissal and which
 * side they open on.
 *
 * The interface is a list of items, not a set of booleans: a caller says what
 * it offers, and nothing here knows what a folder or an artifact is. That is
 * what lets the assets band offer a strict subset without a flag threaded
 * through for each one.
 */
import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';

export interface RowMenuItem {
  /** Reads as an aria-label, so it names the row: `Delete My doc`. */
  label: string;
  text: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /**
   * OFFERED BUT REFUSED. A row that simply drops the item leaves the person
   * wondering where it went; one that is visibly unavailable says what the
   * rule is — which is why the caller puts the reason in `text`
   * ("delete (12 inside)").
   */
  disabled?: boolean;
}

const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors';

export default function RowMenu({ name, items }: { name: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // A menu that outlives the click that dismissed it is the bug every
  // hand-rolled popover ships with once.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <span ref={box} className="relative z-10 inline-flex">
      <Tooltip content="more">
        <button
          type="button"
          className={`${ICON_ACTION} ${open ? 'text-fg' : 'hover:text-accent'}`}
          aria-label={`More actions for ${name}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Ellipsis size={13} />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-36 whitespace-nowrap rounded-[6px] border border-edge bg-surface p-1 font-mono text-xs shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-label={item.label}
              disabled={item.disabled}
              className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-muted disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent enabled:cursor-pointer enabled:hover:bg-raised ${item.danger ? 'enabled:hover:text-danger' : 'enabled:hover:text-fg'}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon} {item.text}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Deleting an artifact, with the confirmation the act deserves. Shared so the
 * two menus cannot drift into warning about different things.
 *
 * A FOLDER NAMES WHAT GOES WITH IT. Deleting one is deleting everything under
 * it — one statement, since placement is `ancestor_ids` (lib/trash) — so the
 * count belongs in the sentence the person answers, not in a refusal they have
 * to work around. It says the trash and the undo too, because what makes
 * taking a folder full of documents an ordinary act rather than a cliff is
 * that it is recoverable — which is why the plain sentence says it too. It
 * used to read "the link dies and history is erased", written when a delete
 * WAS one hard DELETE; with the trash under it, only the first half is true.
 */
export async function confirmDeleteArtifact(id: string, name: string, inside = 0): Promise<boolean> {
  const message = inside > 0
    ? `Delete ${name} and the ${inside} item${inside === 1 ? '' : 's'} inside it? They go to the trash, and you can restore them any time.`
    : `Delete "${name}"? The link stops working. It goes to the trash, where you can restore it any time.`;
  if (!confirm(message)) return false;
  const res = await fetch(`/api/my/artifacts/${id}`, { method: 'DELETE' });
  return res.ok;
}
