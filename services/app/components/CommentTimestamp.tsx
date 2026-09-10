import { Tooltip } from './Tooltip';

/** Comment previews and replies use the viewer's local time, with an exact,
 * keyboard-accessible timestamp rather than a native title tooltip. */
export function CommentTimestamp({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
  });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const exact = date.toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
  });
  return (
    <Tooltip content={exact}>
      <time dateTime={iso} aria-label={exact} tabIndex={0} className={className}>
        {day} · {time}
      </time>
    </Tooltip>
  );
}
