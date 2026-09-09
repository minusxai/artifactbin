import { githubWidgetMarkup } from '@/lib/github-star';

export default function GitHubStar({ placement }: { placement: 'mobile-bar' | 'desktop-bar' }) {
  const mobile = placement === 'mobile-bar';
  return <span
    data-mx-github-star=""
    className={`${mobile ? 'inline-flex sm:hidden' : 'hidden sm:inline-flex'} h-7 shrink-0 items-center text-muted print:hidden`}
    dangerouslySetInnerHTML={{ __html: githubWidgetMarkup(!mobile) }}
  />;
}
