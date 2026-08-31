/**
 * The entire component kit. Terminal-graphite: 1px edges, 4px radii, mono
 * everything, one green accent. Deliberately tiny — grow it only when a
 * pattern repeats three times.
 */
import { EyeOff, Globe, Lock } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { Tooltip } from '@/components/Tooltip';

const BUTTON_VARIANTS = {
  solid:
    'bg-accent text-bg border border-accent hover:brightness-110 font-semibold',
  ghost:
    'bg-transparent text-fg border border-edge-bright hover:border-accent hover:text-accent',
  danger:
    'bg-transparent text-danger border border-edge-bright hover:border-danger hover:bg-danger-soft',
} as const;

export function Button({
  variant = 'solid',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      className={`cursor-pointer rounded-[4px] px-3 py-1.5 font-mono text-xs transition-colors disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-[4px] border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none ${className}`}
      {...props}
    />
  );
}

/**
 * An mx_ token field: masked like a password, invisible to the password
 * manager. type="password" made Chrome treat these as site credentials and
 * offer to save/update them — for a value that is pasted once and exchanged
 * for an httpOnly cookie, never stored by the page.
 */
export function TokenInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      type="text"
      autoComplete="off"
      spellCheck={false}
      className={`[-webkit-text-security:disc] ${className}`}
      {...props}
    />
  );
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'dim' }) {
  const tones = {
    default: 'border-edge-bright text-muted',
    accent: 'border-accent/40 text-accent bg-accent-soft',
    dim: 'border-edge text-faint',
  } as const;
  return (
    <span className={`inline-block rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Content-tier badge — hues from flatuicolors.com/palette/defo (the minusx
 * palette). Flat tint: the hue carries text, hairline, and a whisper of fill.
 */
export const FORMAT_COLORS: Record<string, string> = {
  markup: '#c0392b', // Pomegranate
};

/** Display name for a normalized format — the designed tier is BRANDED
 * "mx-markup" everywhere humans read it; the API field stays `markup`. */
export function formatLabel(format: string): string {
  return format === 'markup' ? 'mx-markup' : format;
}

export function FormatBadge({ format }: { format?: string }) {
  // No fallback tier: an artifact HAS a format. Defaulting to a retired tier
  // name is how one keeps appearing on profiles after it is deleted.
  const key = format ?? 'markup';
  const color = FORMAT_COLORS[key] ?? '#95a5a6';
  return (
    <span
      className="inline-block rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap"
      style={{ color, borderColor: `${color}4d`, background: `${color}14` }}
    >
      {formatLabel(key)}
    </span>
  );
}

/** Visibility is one accent status family. The glyph and word carry the
 * state; the shared theme token supplies one green in light mode and one in
 * dark mode without assigning semantic severity colors to access levels. */
const VISIBILITY_COLOR = 'var(--color-accent)';
export const VISIBILITY_COLORS: Record<string, string> = {
  public: VISIBILITY_COLOR,
  unlisted: VISIBILITY_COLOR,
  private: VISIBILITY_COLOR,
};

export const VISIBILITY_TIPS: Record<string, string> = {
  public: 'anyone with the link · listed on your public profile',
  unlisted: 'anyone with the link · not listed anywhere',
  private: 'only you and invited emails',
};

const VISIBILITY_ICON = { public: Globe, unlisted: EyeOff, private: Lock } as const;

export function VisibilityPill({ visibility, name, compact = false, overlay = false }: {
  visibility: 'public' | 'unlisted' | 'private';
  /** What the row is called — the label says which artifact this describes. */
  name: string;
  /**
   * Glyph only, word in the tooltip. For a DENSE list, where the flexible
   * column is the title and every pill widened is a title truncated earlier:
   * the distinct glyph keeps the state scannable, and the label still carries
   * it for anyone reading by other means.
   */
  compact?: boolean;
  /** Flat, opaque-enough treatment for placement over preview imagery. */
  overlay?: boolean;
}) {
  const Glyph = VISIBILITY_ICON[visibility];
  return (
    <Tooltip content={VISIBILITY_TIPS[visibility]}>
      <span
        aria-label={`${name} is ${visibility}`}
        className={`inline-flex shrink-0 items-center gap-1 border font-mono text-[10px] leading-none whitespace-nowrap ${
          overlay
            ? 'h-[26px] rounded-[4px] border-accent/40 bg-accent-soft px-2 text-accent'
            : `rounded-[3px] border-accent/40 bg-accent-soft py-0.5 text-accent ${compact ? 'px-1' : 'px-1.5'}`
        }`}
      >
        <Glyph size={9} />
        {!compact && visibility}
      </span>
    </Tooltip>
  );
}

/** Blog-style absolute date ("Aug 8, 2026") — the public face of a timestamp;
 * relative times stay on the owner's surfaces (they narrate activity). */
export function dateStamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact relative time: "just now" → "5 mins ago" → "3 hrs ago" → "Aug 8, 2026". */
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  return dateStamp(iso);
}

/** Uppercase micro-label used for table headers and section titles. */
export function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{children}</span>;
}

/**
 * A server-rendered spline (lib/viz/sparkline), made FLUID and drawn at
 * whatever size the caller's className says. The SVG arrives with a fixed
 * width/height, so it is given a viewBox + `preserveAspectRatio="none"` and
 * stretched to the wrapper — which is what lets one 96×20 render serve the
 * shelf's full-width hero line, a table cell, and a 12px phone meta mark
 * without a second vega pass. `filled` drops the area fill for line-only
 * (the hero's extra-wide spline reads cleaner unfilled).
 * Decoration beside a count, so hidden from the accessibility tree.
 */
export function Spark({ svg, filled = true, className = '' }: { svg: string; filled?: boolean; className?: string }) {
  const fluid = svg.replace(/^<svg([^>]*)>/, (_tag, attrs: string) => {
    const width = attrs.match(/\swidth="([\d.]+)"/)?.[1];
    const height = attrs.match(/\sheight="([\d.]+)"/)?.[1];
    let next = attrs;
    if (!/\sviewBox=/.test(next) && width && height) next += ` viewBox="0 0 ${width} ${height}"`;
    if (!/\spreserveAspectRatio=/.test(next)) next += ' preserveAspectRatio="none"';
    return `<svg${next}>`;
  });
  // The stretch is non-uniform (wide, never tall), and a stroke scales with
  // the geometry it rides: the spike's near-vertical segments drew ~5× fatter
  // than the flat baseline. Non-scaling strokes keep one screen thickness.
  const uniform = fluid.replace(/<path\b(?![^>]*\svector-effect=)/g, '<path vector-effect="non-scaling-stroke" ');
  const drawn = filled ? uniform : uniform.replace(/(<path\b[^>]*\sfill-opacity=)"[^"]*"/g, '$1"0"');
  return (
    <span
      aria-hidden="true"
      className={`flex items-center [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: drawn }}
    />
  );
}

/**
 * THE COLUMN EVERY APP PAGE IS MEASURED AGAINST — masthead and content alike.
 *
 * One constant rather than a literal per page, because the two that drifted
 * apart were the masthead and the dashboard under it: the rule beneath the
 * logo stopped short of the panels below, and the same shelf laid out at two
 * different widths depending on whether it was reached at `/` or `/@handle`.
 *
 * Shared rather than widened: `HeaderBar` heads every page in the shell, and
 * account and docs are deliberately narrow for reading and forms. One width
 * they can all sit at beats a width threaded through as a prop.
 */
export const PAGE_COLUMN = 'mx-auto max-w-4xl px-4 sm:px-6';

export const PANEL = 'rounded-[6px] border border-edge bg-surface';
export const TABLE_ROW = 'border-t border-edge hover:bg-raised transition-colors';
export const LINK = 'text-accent no-underline hover:underline underline-offset-4';
