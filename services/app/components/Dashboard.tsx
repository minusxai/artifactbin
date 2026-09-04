import { MicroLabel, timeAgo } from '@/components/ui';
import type { ShelfRow } from '@/components/Shelf';

/** A compact owner-only readout above the library. Profiles never mount it. */
export default function Dashboard({ rows }: { rows: ShelfRow[] }) {
  const posts = rows.filter((row) => row.format === 'markup');
  const totalViews = posts.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const publicPosts = posts.filter((row) => row.visibility === 'public').length;
  const notListed = posts.length - publicPosts;
  const ranked = [...posts]
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  const maxViews = Math.max(1, ...ranked.map((row) => row.views ?? 0));

  return (
    <section aria-label="Dashboard" className="reveal mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <MicroLabel>dashboard</MicroLabel>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg">Your posts</h1>
        </div>
        <span className="font-mono text-[10px] text-faint">all-time readership</span>
      </div>

      <dl className="grid grid-cols-2 border-y border-edge sm:grid-cols-4">
        {[
          ['posts', posts.length],
          ['public', publicPosts],
          ['not listed', notListed],
          ['views', totalViews],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`py-3 pr-4 ${index % 2 ? 'border-l border-edge pl-4' : ''} ${
              index > 1 ? 'border-t border-edge sm:border-t-0' : ''
            } ${index > 0 ? 'sm:border-l sm:border-edge sm:pl-4' : ''}`}
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</dt>
            <dd className="mt-1 font-mono text-2xl leading-none font-medium tabular-nums text-fg">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-xs font-semibold text-fg">Views by post</h2>
          {posts[0] && (
            <span className="font-mono text-[10px] text-faint">updated {timeAgo(posts[0].updated_at)}</span>
          )}
        </div>
        {ranked.length === 0 ? (
          <p className="font-mono text-xs text-faint">No posts yet.</p>
        ) : (
          <ol className="space-y-2" aria-label="Top posts by views">
            {ranked.map((row, index) => {
              const views = row.views ?? 0;
              return (
                <li key={row.id} className="reveal grid grid-cols-[minmax(7rem,0.8fr)_minmax(6rem,1.4fr)_2.5rem] items-center gap-3" style={{ animationDelay: `${index * 45}ms` }}>
                  <span className="truncate text-xs text-muted">{row.title ?? 'Untitled'}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                      style={{ width: views === 0 ? '0%' : `${Math.max(3, (views / maxViews) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-muted">{views}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
