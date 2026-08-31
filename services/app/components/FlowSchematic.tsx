/**
 * The product as a pipeline: agent → artifact-bin → permalink. Decorative
 * (aria-hidden) — every page that draws it must carry the same sentence as
 * real text. Server-safe: pure SVG on theme tokens, no client code.
 */
export default function FlowSchematic({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 560 44" width={560} height={44} className={`max-w-full ${className}`}>
      <defs>
        <marker id="mx-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--color-faint)" />
        </marker>
      </defs>
      <rect x="1" y="6.5" width="96" height="31" rx="5" fill="var(--color-surface)" stroke="var(--color-edge-bright)" />
      <text x="49" y="26" fontSize="12.5" textAnchor="middle" fill="var(--color-muted)">
        your agent
      </text>
      <line x1="105" y1="22" x2="185" y2="22" stroke="var(--color-faint)" markerEnd="url(#mx-flow-arrow)" />
      <text x="145" y="14" fontSize="10" textAnchor="middle" fill="var(--color-faint)">
        publish
      </text>
      <rect x="195" y="6.5" width="112" height="31" rx="5" fill="var(--color-accent-soft)" stroke="var(--color-accent)" />
      <text x="251" y="26" fontSize="12.5" textAnchor="middle" fill="var(--color-accent)">
        artifact-bin
      </text>
      <line x1="315" y1="22" x2="395" y2="22" stroke="var(--color-faint)" markerEnd="url(#mx-flow-arrow)" />
      {/* The deliverable, dressed as what it is: a permalink chip. */}
      <rect x="405" y="6.5" width="154" height="31" rx="15.5" fill="var(--color-bg)" stroke="var(--color-faint)" strokeDasharray="4 3" />
      <g transform="translate(417 15) scale(0.55)" stroke="var(--color-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" x2="16" y1="12" y2="12" />
      </g>
      <text x="436" y="26" fontSize="12.5" fill="var(--color-fg)">
        a sharable link
      </text>
    </svg>
  );
}
