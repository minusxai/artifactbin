/* @jsxImportSource solid-js */
/**
 * ONE COMMENT'S ACTIONS in a rail thread (AnnotationThread): edit, for the words' author, and delete, for its author or
 * the document owner. The root comment's menu speaks for the thread (Delete thread), a reply's for itself.
 */
import { ErrorBoundary, lazy, Suspense, type JSX } from 'solid-js';
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical';
import Pencil from 'lucide-solid/icons/pencil';
import Trash2 from 'lucide-solid/icons/trash-2';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { isChunkLoadError, reloadForNewBuild } from '../lib/app-build';

/**
 * The delete menu is a lazy chunk (an intentional exception to top-level imports): it matters only once a thread is on
 * screen, so the reader page, which statically imports this layer, does not carry ui/Menu. Its trigger renders at once
 * as the plain fallback below, and the real Menu replaces it as the chunk lands (it starts loading with the first thread).
 */
const Menu = lazy(() => import('../ui/Menu').then((module) => ({ default: module.Menu })));
export const preloadThreadMenu = (): Promise<unknown> => Menu.preload();

/** What the root comment's menu (index 0) and a reply's are called. */
const NAMES = [
  { tip: 'thread actions', trigger: () => 'Annotation actions', menu: 'Annotation action menu', remove: 'Delete thread' },
  { tip: 'comment actions', trigger: (ordinal: number) => `Comment actions ${ordinal}`, menu: 'Comment action menu', remove: 'Delete comment' },
];

export function CommentActions(props: { ordinal: number; busy: boolean; editBusy: boolean; onEdit?: () => void; onDelete?: () => void }): JSX.Element {
  const names = () => NAMES[props.ordinal === 0 ? 0 : 1]!;
  const trigger = (attrs?: object) => (
    <Tooltip content={names().tip}>
      <Button aria-haspopup="menu" aria-expanded={false} {...attrs} type="button" variant="ghost" size="sm" icon aria-label={names().trigger(props.ordinal)} class="-mr-1">
        <EllipsisVertical size={13} strokeWidth={1.8} />
      </Button>
    </Tooltip>
  );
  // A chunk that cannot be fetched (the local preview restarted while it loaded, a dropped connection) leaves the
  // trigger standing, unavailable until the page loads again, instead of an uncaught error. One a deploy removed
  // loads the new build (solid/lib/app-build; the thread's drafts are kept).
  return <ErrorBoundary fallback={(error) => { if (isChunkLoadError(error)) reloadForNewBuild(); return trigger({ disabled: true }); }}><Suspense fallback={trigger()}>
    <Menu label={names().menu}
      items={[
        ...(props.onEdit ? [{ label: 'Edit comment', text: 'edit', icon: () => <Pencil size={12} strokeWidth={1.75} />, disabled: props.busy || props.editBusy, onSelect: () => props.onEdit?.() }] : []),
        ...(props.onDelete ? [{ label: names().remove, text: names().remove.toLowerCase(), icon: () => <Trash2 size={12} strokeWidth={1.75} />, danger: true, disabled: props.busy, onSelect: () => props.onDelete?.() }] : []),
      ]}
      trigger={(attrs) => trigger(attrs)} />
  </Suspense></ErrorBoundary>;
}
