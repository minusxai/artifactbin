import { useLayoutEffect, useMemo, useRef } from 'react';
import { githubStarMarkup, wireGithubStar } from '@/lib/github-star';

export default function GitHubStar({ placement }: { placement: 'mobile-bar' | 'desktop-bar' }) {
  const mobile = placement === 'mobile-bar';
  const root = useRef<HTMLSpanElement>(null);
  // Keep the hydrated count when the parent rerenders.
  const markup = useMemo(() => ({ __html: githubStarMarkup(!mobile) }), [mobile]);
  useLayoutEffect(() => root.current ? wireGithubStar(root.current) : undefined, [mobile]);
  return <span
    ref={root}
    data-mx-github-star=""
    className={`${mobile ? 'inline-flex sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-fg print:hidden`}
    dangerouslySetInnerHTML={markup}
  />;
}
