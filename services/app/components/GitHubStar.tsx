import { Star } from 'lucide-react';
import { GitHubIcon } from '@/components/brand-icons';
import { REPO_URL } from '@/lib/repo';
import { useEffect, useState } from 'react';
import { githubStarLabel, githubCountText, subscribeGithubStars } from '@/lib/github-star';

export default function GitHubStar({ placement }: { placement: 'mobile-bar' | 'desktop-bar' }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => subscribeGithubStars(setCount), []);
  const position = placement === 'mobile-bar'
    ? 'inline-flex h-9 shrink-0 sm:hidden'
    : 'hidden h-7 shrink-0 sm:inline-flex';
  return (
    <a
      href={REPO_URL}
      data-mx-github-star=""
      target="_blank"
      rel="noopener noreferrer"
      aria-label={githubStarLabel(count)}
      className={`${position} items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-edge bg-surface px-2.5 font-mono text-[10px] tracking-[0.04em] text-fg no-underline transition-colors hover:text-accent hover:border-edge-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent print:hidden`}
    >
      <GitHubIcon size={13} />
      <span>STAR</span>
      <Star size={13} strokeWidth={1.5} fill="currentColor" className="text-[#efb000]" aria-hidden="true" />
      <span data-mx-github-count="" aria-hidden="true" className={`${placement === 'mobile-bar' ? 'hidden' : 'inline-block'} w-[6ch] text-right tabular-nums`}>{githubCountText(count)}</span>
    </a>
  );
}
