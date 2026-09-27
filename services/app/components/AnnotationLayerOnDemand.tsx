/**
 * The comment layer, downloaded for the people who may comment rather than
 * with the document every reader opens (lib/__tests__/reader-bundle-hygiene).
 *
 * The page mounts this only for a viewer who may annotate, and the download
 * starts on that mount — the layer draws the ambient marks of open threads, so
 * a commenter wants it straight away, in parallel with the document runtime.
 * Until it lands, nothing a person asks for is dropped:
 *
 *  - opening comments draws the real rail frame (components/AnnotationRail) at
 *    once, busy, and the layer's own rail replaces it in the same place;
 *  - a comment on a selection is a prop the page already holds
 *    (`initialSelection`), so the composer opens on arrival; a Select pressed
 *    in the document is held here and handed over (`pickRequested`);
 *  - either shows that comments are loading meanwhile, and a failed download
 *    says so with Retry — never a control that silently does nothing.
 */
import { useEffect, useState, type ComponentProps } from 'react';
import { X } from 'lucide-react';
import type AnnotationLayer from '@/components/AnnotationLayer';
import { onDemand, useOnDemand } from '@/lib/dynamic';
import { RailChrome } from '@/components/AnnotationRail';
import { LoadFailure } from '@/components/LoadFailure';
import { useIsPhoneViewport } from '@/components/MobileSheet';
import { subscribeDocument } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, STORY_SELECTION_ACTION_MESSAGE } from '@/lib/story-runtime/contract';

/** The one comment-layer download, shared by the mount and any warm. */
export const annotationLayerFeature = onDemand(() => import('@/components/AnnotationLayer'));

type AnnotationLayerProps = Omit<ComponentProps<typeof AnnotationLayer>, 'pickRequested'>;

export default function AnnotationLayerOnDemand(props: AnnotationLayerProps) {
  const { module, failed, retry } = useOnDemand(annotationLayerFeature);
  const [pickRequested, setPickRequested] = useState(false);
  const phone = useIsPhoneViewport();
  const { runtimeRef, frameRef, sessionNonce, pickOnOpen = true } = props;
  // The layer owns the document's Select tool; until it is here, remember a press.
  useEffect(() => {
    if (module || !sessionNonce || !pickOnOpen) return;
    return subscribeDocument({ runtimeRef, frameRef }, (event) => {
      if (!isEditFrameMessage(event.data, sessionNonce)) return;
      if (event.data.type === STORY_SELECTION_ACTION_MESSAGE && event.data.action === 'select') setPickRequested(true);
    });
  }, [module, runtimeRef, frameRef, sessionNonce, pickOnOpen]);

  if (module) {
    const Real = module.default;
    return <Real {...props} pickRequested={pickRequested} />;
  }
  const status = failed
    ? <LoadFailure what="comments" onRetry={retry} className="p-2" />
    : <p role="status" aria-label="Loading comments" className="p-2 font-mono text-xs text-muted">loading comments…</p>;
  if (props.railOpen && props.railHost !== null) {
    const close = () => props.onRailOpenChange(false);
    return (
      <RailChrome
        busy
        phone={phone || !!props.railSheet}
        host={props.railHost}
        topOffset={props.topOffset}
        rightInset={props.rightInset ?? 0}
        onClose={close}
        header={<RailHeader onClose={close} />}
      >
        {status}
      </RailChrome>
    );
  }
  // Nothing opened yet: say so only when someone asked, or when it failed.
  if (!failed && !pickRequested && !props.initialSelection) return null;
  return (
    <div aria-busy={!failed || undefined} className="fixed right-3 z-20 rounded-[6px] border border-edge bg-raised" style={{ top: props.topOffset + 8 }}>
      {status}
    </div>
  );
}

/** The layer's rail header, in its geometry: the title, the Select tool's place, the way out. */
function RailHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">comments</h2>
      <span aria-hidden="true" className="ml-auto inline-flex h-7 w-[62px] rounded-[3px]" />
      <button
        type="button"
        aria-label="Close comments"
        onClick={onClose}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg"
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
