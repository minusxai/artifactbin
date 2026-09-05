import { Star } from 'lucide-react';
import { GitHubIcon } from '@/components/brand-icons';
import { REPO_URL } from '@/lib/repo';

export default function GitHubStar() {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Star artifactbin on GitHub (opens in a new tab)"
      className="fixed right-24 top-1 z-40 inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-edge bg-surface px-2.5 font-mono text-[10px] tracking-[0.04em] text-fg no-underline transition-colors hover:text-accent hover:border-edge-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-7 sm:top-auto sm:right-[max(20px,env(safe-area-inset-right))] sm:bottom-[max(20px,env(safe-area-inset-bottom))] print:hidden"
    >
      <GitHubIcon size={13} />
      <span>STAR</span>
      <Star size={13} strokeWidth={1.5} fill="currentColor" className="text-[#efb000]" aria-hidden="true" />
    </a>
  );
}
