'use client';

/**
 * The version-history drawer: a right-hand panel that does not exist until asked
 * for (the parent mounts it), so the editing surface stays undivided.
 *
 * The two things you can do with the past are weighted differently, because they
 * are: LOOKING is the whole row (free, reversible), and MAKING IT THE PRESENT
 * appears only on the row you are already looking at. Selection wears the app's
 * established "you are here" treatment (the sidebar's accent), so the row being
 * previewed is as obvious as the current page in the rail.
 */
import { Eye, RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import { Tooltip } from '@/components/Tooltip';
import { timeAgo } from '@/components/ui';
import type { ArtifactVersionSummary } from '@/lib/story/use-versions';

export interface VersionHistoryProps {
  versions: ArtifactVersionSummary[];
  /** The live version — named at the top so "where am I" is never a guess. */
  currentVersion: number;
  /** The version being previewed, if any. */
  previewing: number | null;
  onPreview: (version: number) => void;
  onRestore: (version: number) => void;
  /** Leaves any preview and returns to the live document. */
  onBackToCurrent: () => void;
  onClose: () => void;
  busy: boolean;
}

/**
 * Selected rows use the sidebar's active treatment — one "you are here" in the app.
 * Padding is on the shared helper so the current-version row and the history rows
 * keep the same rhythm; now that rows are a single line, they can afford the air.
 */
const ROW = (selected: boolean) =>
  `border-b border-edge px-3 py-2.5 transition-colors ${
    selected ? 'border-l-2 border-l-accent bg-accent-soft' : 'border-l-2 border-l-transparent hover:bg-raised'
  }`;

export default function VersionHistory({
  versions, currentVersion, previewing, onPreview, onRestore, onBackToCurrent, onClose, busy,
}: VersionHistoryProps) {
  const phone = useIsPhoneViewport();
  // Escape closes, like any transient panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const head = (
    <header className="flex items-center justify-between border-b border-edge px-3 py-2">
      <span className="font-mono text-xs font-semibold text-fg">history</span>
      <Tooltip content="close" positioning={{ placement: 'bottom-end' }}>
        <button
          type="button"
          aria-label="Close version history"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      </Tooltip>
    </header>
  );

  const content = (
    <>
      <div className="flex-1 overflow-y-auto">
        {/* The live document as a row of its own, so the list is the whole
            timeline rather than "the past, plus wherever you happen to be".
            Its label differs from the preview banner's identical action so the
            two are distinguishable to a screen reader. */}
        <button
          type="button"
          aria-label="Show the current version"
          onClick={onBackToCurrent}
          className={`flex w-full items-baseline justify-between text-left ${ROW(previewing === null)}`}
        >
          <span className={`font-mono text-xs font-semibold ${previewing === null ? 'text-accent' : 'text-fg'}`}>
            v{currentVersion}
          </span>
          <span className="font-mono text-[10px] text-muted">current</span>
        </button>

        {versions.length === 0 && (
          <p className="px-3 py-3 font-mono text-[11px] text-muted">no earlier versions yet.</p>
        )}

        {versions.map((v) => {
          const selected = previewing === v.version;
          // TWO lines, fixed: version and name on the first (the name truncates —
          // it is the least load-bearing thing in the row), actions and time on
          // the second. A third line per row made a short history taller than the
          // document it belongs to.
          return (
            // The whole row previews — looking costs nothing and is reversible, so
            // it deserves the biggest target rather than a 20px icon. `div` with
            // button semantics, not a <button>, because restore nests inside it and
            // a button inside a button is invalid.
            <div
              key={v.version}
              role="button"
              tabIndex={0}
              aria-label={`Preview version ${v.version}`}
              aria-pressed={selected}
              onClick={() => onPreview(v.version)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPreview(v.version);
                }
              }}
              // `group`: the row hints what it does on hover (the eye below)
              // instead of carrying a permanent button. Cursor and background
              // alone were too quiet to read as "this is clickable".
              className={`group cursor-pointer ${ROW(selected)}`}
            >
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className={`shrink-0 font-mono text-xs ${selected ? 'font-semibold text-accent' : 'text-fg'}`}>
                  v{v.version}
                </span>
                {v.title && (
                  <span className="truncate font-sans text-[11px] text-muted">
                    · {v.title}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted">
                  {/* The affordance, revealed on hover: says "look at this one"
                      without competing with restore for attention. */}
                  <Eye
                    size={11}
                    aria-hidden="true"
                    className={`transition-opacity ${selected ? 'opacity-0' : 'opacity-0 group-hover:opacity-70'}`}
                  />
                  {/* Who made it, when the row knows — a collaborator's edits
                      are the reason history can say so at all. */}
                  {v.by && <span aria-label={`Version ${v.version} by ${v.by}`}>@{v.by} ·</span>}
                  {timeAgo(v.created_at)}
                </span>
              </div>
              {/* Restore appears only on the row you are LOOKING at: it is the
                  consequential act of the two, so it costs a deliberate step
                  instead of sitting one stray click away on every row — and an
                  unselected row stays a single line. */}
              {selected && (
                <button
                  type="button"
                  aria-label={`Restore version ${v.version}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation(); // the row itself means "preview"
                    onRestore(v.version);
                  }}
                  className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-accent/40 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  <RotateCcw size={11} /> restore
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Said once, at the foot, instead of on every row: a restore archives the
          current state too, so nothing here is a one-way door. */}
      <p className="border-t border-edge px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">
        restoring makes a new version — the current one is kept, so it can be undone.
      </p>
    </>
  );

  // On a phone the drawer is a HALF bottom sheet — previewing a version is
  // the whole point, and the document being previewed must stay visible.
  if (phone) {
    return (
      <MobileSheet label="Version history" onClose={onClose} size="half" header={head}>
        <div className="flex flex-col">{content}</div>
      </MobileSheet>
    );
  }
  return (
    <aside
      aria-label="Version history"
      className="absolute right-0 top-0 z-20 flex h-full w-64 flex-col border-l border-edge bg-surface shadow-xl"
    >
      {head}
      {content}
    </aside>
  );
}
