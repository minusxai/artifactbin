/**
 * The profile and folder listings — the pretty-URL page's chrome, rendered
 * in the browser from /api/page/profile. Moved out of the Next page as-is.
 */
import HeaderBar, { type HeaderStats } from '@/components/HeaderBar';
import PageChrome from '@/components/PageChrome';
import { PAGE_COLUMN, Badge, dateStamp, FormatBadge, MicroLabel, timeAgo } from '@/components/ui';
import { canonicalArtifactPath } from '@/lib/urls';
import type { ArtifactSummary } from '@/lib/artifacts';
import type { Viewer } from '@/lib/artifacts';

function statsOf(artifacts: { format: string }[]): HeaderStats {
  const formats: Record<string, number> = { markup: 0, html: 0 };
  for (const a of artifacts) {
    formats[a.format] = (formats[a.format] ?? 0) + 1;
  }
  return { total: artifacts.length, formats };
}

/**
 * App masthead + the shared column every listing view lives in. The controls
 * sit in the masthead's open top corners; no persistent strip is reserved.
 */
export function ListingShell({ email, stats, authed = false, anon = false, children }: {
  email: string | null; stats: HeaderStats | null; authed?: boolean; anon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageChrome authed={authed} anon={anon} />
      <HeaderBar email={email} stats={stats} />
      {/* The SHARED column: a profile and the dashboard render the same
        * shelf, so they must be the same width, and the masthead above them
        * spans it too (web/__tests__/shelf-pages). */}
      <main className={`${PAGE_COLUMN} pt-10 pb-24`}>{children}</main>
    </>
  );
}

/**
 * The profile masthead: micro-label, the handle as a breadcrumb (each folder
 * segment its own link), and a one-line readout of what sits below.
 */
export function ListingHero({ handle, folder, label, count, noun }: {
  handle: string; folder: string; label: string; count: number; noun: string;
}) {
  const segments = folder ? folder.split('/') : [];
  return (
    <header className="reveal mb-8">
      <MicroLabel>{label}</MicroLabel>
      <h1 className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-3xl font-semibold tracking-tight text-fg">
        <a href={`/@${handle}`} aria-label="Profile root" className="no-underline transition-colors hover:text-accent">
          <span className="text-accent">@</span>{handle}
        </a>
        {segments.map((segment, i) => (
          <span key={i} className="flex items-baseline gap-x-1.5">
            <span className="font-normal text-faint">/</span>
            <a
              href={`/@${handle}/${segments.slice(0, i + 1).join('/')}`}
              aria-label={`Open folder ${segment}`}
              className="no-underline transition-colors hover:text-accent"
            >
              {segment}
            </a>
          </span>
        ))}
      </h1>
      <p className="mt-3 font-mono text-xs text-muted">
        {count} {noun}
        {count === 1 ? '' : 's'}
      </p>
    </header>
  );
}

export function NothingHere() {
  return (
    <p className="reveal font-mono text-sm text-muted">
      <span className="text-accent">$</span> nothing here yet
      <span className="caret text-accent">▍</span>
    </p>
  );
}

const delay = (i: number) => ({ animationDelay: `${Math.min(i * 45, 450)}ms` });

const folderDelay = (i: number) => ({ animationDelay: `${Math.min(i * 45, 450)}ms` });

/**
 * Folders as navigation. All that survives of the old ListingPanel: its file
 * rows are the shelf's dense tier now. Folders exist only as paths on files,
 * so a folder row is a derived prefix, never a record.
 */
export function FolderPanel({ handle, folders }: { handle: string; folders: string[] }) {
  return (
    <ul className="overflow-hidden rounded-[6px] border border-edge bg-surface">
      {folders.map((path, i) => {
        const name = path.split('/').pop()!;
        return (
          <li key={path} className={i > 0 ? 'border-t border-edge' : ''}>
            <a
              href={`/@${handle}/${path}`}
              aria-label={`Open folder ${name}`}
              className="reveal group flex items-center justify-between gap-4 px-4 py-3 no-underline transition-colors hover:bg-raised"
              style={folderDelay(i)}
            >
              <span className="truncate font-mono text-sm font-semibold text-fg transition-colors group-hover:text-accent">
                {`${name}/`}
              </span>
              <MicroLabel>folder</MicroLabel>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
