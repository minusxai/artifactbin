'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FormatBadge, formatLabel, LINK, MicroLabel, PANEL, TABLE_ROW, timeAgo } from '@/components/ui';
import { SHARE_ROLE_LABEL, SHARE_ROLES } from '@/lib/share-roles';
import type { SharedArtifactSummary } from '@/lib/users';

/**
 * The dashboard's recipient-side view of `artifact_shares` — the rediscovery
 * surface a share otherwise lacks (lose the link, lose the document), and
 * where the recipient learns what they may DO with it (their role). Rows
 * link to the universal `/a/<id>` form: the viewer is NOT the owner, so
 * pretty owner-URLs are decoration they may not be able to resolve, and the
 * short form is the one address every reader can always use.
 *
 * Renders NOTHING when nothing is shared: an empty "shared with you" panel
 * would read as a bug on every fresh dashboard.
 */
const FORMAT_ORDER: string[] = ['markup', 'dataset', 'viz', 'image'];

function FilterChip({ value, label, active, onToggle }: {
  value: string;
  label: string;
  active: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Filter ${value}`}
      aria-pressed={active}
      onClick={() => onToggle(value)}
      className={`inline-flex cursor-pointer items-center rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-edge bg-transparent text-faint hover:border-edge-bright hover:text-muted'
      }`}
    >
      {label}
    </button>
  );
}

export default function SharedWithYou({ items }: { items: SharedArtifactSummary[] }) {
  const [query, setQuery] = useState('');
  const [formatPicks, setFormatPicks] = useState<string[]>([]);
  const [rolePicks, setRolePicks] = useState<string[]>([]);

  const togglePick = (set: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    set((picks) => (picks.includes(value) ? picks.filter((pick) => pick !== value) : [...picks, value]));

  const formatsPresent = new Set<string>(items.map((item) => item.format ?? 'markup'));
  const formats = [
    ...FORMAT_ORDER.filter((format) => formatsPresent.has(format)),
    ...[...formatsPresent].filter((format) => !FORMAT_ORDER.includes(format)),
  ];
  const roles = SHARE_ROLES.filter((role) => items.some((item) => item.role === role));
  const showFormats = formats.length >= 2;
  const showRoles = roles.length >= 2;
  const q = query.trim().toLowerCase();
  const filtering = Boolean(q) || formatPicks.length > 0 || rolePicks.length > 0;

  const visible = useMemo(() => items.filter((item) => {
    const format = item.format ?? 'markup';
    const searchable = [
      item.title,
      item.description,
      item.id,
      item.owner_username ? `@${item.owner_username}` : null,
      formatLabel(format),
      SHARE_ROLE_LABEL[item.role],
    ].filter(Boolean).join(' ').toLowerCase();
    return (!q || searchable.includes(q)) &&
      (formatPicks.length === 0 || formatPicks.includes(format)) &&
      (rolePicks.length === 0 || rolePicks.includes(item.role));
  }), [items, q, formatPicks, rolePicks]);

  if (items.length === 0) return null;
  return (
    <section aria-label="Shared with you" className="mt-8">
      <MicroLabel>shared with you</MicroLabel>
      <div className={`${PANEL} mt-2`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            aria-label="Search shared artifacts"
            placeholder="search shared artifacts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
          />
          {(showFormats || showRoles) && (
            <span className="flex shrink-0 flex-wrap items-center gap-1.5 border-edge sm:ml-auto sm:border-l sm:pl-2">
              {showFormats && formats.map((format) => (
                <FilterChip
                  key={format}
                  value={format}
                  label={formatLabel(format)}
                  active={formatPicks.includes(format)}
                  onToggle={togglePick(setFormatPicks)}
                />
              ))}
              {showFormats && showRoles && <span aria-hidden="true" className="mx-1 h-3 w-px bg-edge" />}
              {showRoles && roles.map((role) => (
                <FilterChip
                  key={role}
                  value={role}
                  label={SHARE_ROLE_LABEL[role]}
                  active={rolePicks.includes(role)}
                  onToggle={togglePick(setRolePicks)}
                />
              ))}
            </span>
          )}
          {filtering && (
            <span className="shrink-0 border-l border-edge pl-2 font-mono text-[10px] tabular-nums text-faint">
              {visible.length}/{items.length}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <tbody>
              {visible.length === 0 && (
                <tr className={TABLE_ROW}>
                  <td colSpan={5} className="px-4 py-6 text-center text-faint">
                    {q ? <>nothing matches &ldquo;{query.trim()}&rdquo;</> : 'nothing matches the active filters'}
                  </td>
                </tr>
              )}
              {visible.map((a) => (
                <tr key={a.id} className={TABLE_ROW}>
                  <td className="px-3 py-2">
                    <a href={`/a/${a.id}`} aria-label={`Open shared artifact ${a.id}`} className={LINK}>
                      {a.title || a.id}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-muted">{a.owner_username ? `@${a.owner_username}` : ''}</td>
                  <td className="px-3 py-2 text-muted" aria-label={`Your role on ${a.id}`}>{SHARE_ROLE_LABEL[a.role]}</td>
                  <td className="px-3 py-2">
                    <FormatBadge format={a.format} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted">{timeAgo(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
