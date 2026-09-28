/**
 * THE OUTLINE — inert markup server-rendered by both reader paths beside the
 * story column. A prose document ships no runtime, so outline-nav wires clicks
 * and the current-section mark from the small page entry. Rows are keyed by
 * heading path so live updates keep their identity.
 */
import type { OutlineEntry } from './outline';

export function OutlineRail({ entries }: { entries: readonly OutlineEntry[] }) {
  let section = 0;
  return (
    <nav className="mx-outline" aria-label="Contents">
      <div className="mx-outline-label">Contents</div>
      {entries.map((entry) => {
        if (entry.level === 2) section += 1;
        return (
          <button
            key={entry.path}
            type="button"
            className={entry.level === 3 ? 'mx-outline-row mx-outline-sub' : 'mx-outline-row'}
            aria-label={entry.level === 2 ? `Go to section ${section}: ${entry.title}` : `Go to ${entry.title}`}
            data-mx-target={entry.path}
          >
            {entry.title}
          </button>
        );
      })}
    </nav>
  );
}
