/**
 * ShareLink, downloaded when sharing is about to be used rather than with the
 * document every reader opens (lib/__tests__/reader-bundle-hygiene).
 *
 * Only owners and editors ever reach it, and the page warms it for them while
 * they read (ArtifactSurface: idle, and hovering the controls that open it),
 * so by the time anyone presses share it is normally already here and this
 * renders the real ShareLink on the first commit. If it is not:
 *
 *  - the `menu` row draws exactly what ShareLink draws before its state loads,
 *    marked busy; pressing it opens the dialog frame at once;
 *  - the dialog frame (components/SharePanel — the real one) opens busy, with
 *    a body shaped like the real body's own loading state, and the real dialog
 *    replaces it in place when the code lands;
 *  - a failed download says so, with Retry — never a button that does nothing.
 */
import { useState, type ComponentProps } from 'react';
import type ShareLink from '@/components/ShareLink';
import { onDemand, useOnDemand } from '@/lib/dynamic';
import { SharePanel, VISIBILITY_ICONS, shareTitle } from '@/components/SharePanel';
import { LoadFailure } from '@/components/LoadFailure';

/** The one ShareLink download: the idle warm, a trigger's hover and the mount all share it. */
export const shareLinkFeature = onDemand(() => import('@/components/ShareLink'));

type ShareLinkProps = ComponentProps<typeof ShareLink> & { variant: 'menu' | 'dialog' };

export default function ShareLinkOnDemand(props: ShareLinkProps) {
  const { module, failed, retry } = useOnDemand(shareLinkFeature);
  // The row was pressed before the code arrived: the real dialog opens on arrival.
  const [requested, setRequested] = useState(false);
  if (module) {
    const Real = module.default;
    return <Real {...props} {...(requested ? { initialOpen: true } : {})} />;
  }
  const failure = failed ? <LoadFailure what="sharing" onRetry={retry} /> : null;
  const busyPanel = (onClose: () => void) => (
    <SharePanel busy title={shareTitle(props.title, props.format)} onClose={onClose}>
      {failure ?? <SharePanelSkeleton socialPreview={!!props.onSocialPreview} />}
    </SharePanel>
  );
  if (props.variant === 'dialog') return busyPanel(() => props.onClose?.());
  const Pending = VISIBILITY_ICONS.private;
  return (
    <span className="relative block">
      {failed && !requested ? failure : (
        <button
          type="button"
          aria-label="Share"
          aria-busy="true"
          onClick={() => setRequested(true)}
          className={`flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs transition-colors hover:bg-raised hover:text-fg ${requested ? 'text-accent' : 'text-muted'}`}
        >
          <Pending strokeWidth={1.5} size={14} />
          <span>sharing</span>
        </button>
      )}
      {requested && busyPanel(() => { setRequested(false); props.onClose?.(); })}
    </span>
  );
}

/** The real body's own loading state, in its geometry: the copy row, the card, "loading…". */
function SharePanelSkeleton({ socialPreview }: { socialPreview: boolean }) {
  return (
    <div role="status" aria-label="Loading sharing">
      <div aria-hidden="true" className="mb-4 h-[38px] w-full rounded-[5px] border border-edge bg-raised" />
      {socialPreview && (
        <div aria-hidden="true" className="mx-auto mb-5 w-full max-w-xs">
          <div className="mb-2 h-[16.5px]" />
          <div className="aspect-[40/21] w-full rounded-md border border-edge bg-raised" />
        </div>
      )}
      <p className="text-muted">loading…</p>
    </div>
  );
}
