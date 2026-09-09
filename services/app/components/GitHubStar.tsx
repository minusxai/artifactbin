import { useLayoutEffect, useRef } from 'react';
import { githubWidgetMarkup, wireGithubWidgetTheme } from '@/lib/github-star';

export default function GitHubStar({ placement }: { placement: 'mobile-bar' | 'desktop-bar' }) {
  const mobile = placement === 'mobile-bar';
  const root = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => root.current ? wireGithubWidgetTheme(root.current) : undefined, [mobile]);
  return <span
    ref={root}
    data-mx-github-star=""
    className={`${mobile ? 'inline-flex sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-muted print:hidden`}
    dangerouslySetInnerHTML={{ __html: githubWidgetMarkup(!mobile) }}
  />;
}
