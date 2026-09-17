/**
 * THE MASTHEAD EVERY ASSET PAGE WEARS — the dataset workspace and the file
 * upload alike: an icon tile, an eyebrow naming the workspace, the page's
 * title, and on the right the way out ("all assets →") beside whatever
 * actions the page has. One component, so the two pages cannot drift into
 * two designs.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { LINK } from '@/components/ui';

export default function AssetPageHeader({
  icon: Icon,
  eyebrow,
  title,
  link,
  actions,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  /** The way out, on the right: where this page's work is listed. */
  link: { href: string; label: string; text: string };
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="rounded-xl border border-edge bg-surface p-2.5 text-accent">
          <Icon size={22} />
        </span>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium tracking-widest text-muted uppercase">{eyebrow}</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <a href={link.href} aria-label={link.label} className={`font-mono text-xs ${LINK}`}>
          {link.text} →
        </a>
      </div>
    </header>
  );
}
