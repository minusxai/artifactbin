import { useLayoutEffect, useMemo, useRef } from 'react';
import { githubWidgetMarkup, wireGithubWidgetTheme } from '@/lib/github-star';

export default function GitHubStar({ placement }: { placement: 'mobile-bar' | 'desktop-bar' }) {
  const mobile = placement === 'mobile-bar';
  const root = useRef<HTMLSpanElement>(null);
  // Replacing this object on every render resets the live iframe to hidden
  // markup while the effect still watches the old frame's load events.
  const markup = useMemo(() => ({ __html: githubWidgetMarkup(!mobile) }), [mobile]);
  useLayoutEffect(() => root.current ? wireGithubWidgetTheme(root.current) : undefined, [mobile]);
  return <span
    ref={root}
    data-mx-github-star=""
    className={`${mobile ? 'inline-flex sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-muted print:hidden`}
    dangerouslySetInnerHTML={markup}
  />;
}
