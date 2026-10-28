/* @jsxImportSource solid-js */
/**
 * One right panel for the whole edit session, on a window wide
 * enough to hold it beside the document (lib/story-ui/edit-bar's EDIT_PANEL_BREAKPOINT; narrower windows
 * get bottom sheets instead).
 *
 * The frame is tabs, the dot, collapse. What each tab shows is the caller's.
 *
 * There is no artifact-backend context in the app, so this takes `historyUnavailable` as an explicit
 * prop. Whoever wires this panel into a live page passes `backend.unavailable('versions')`.
 */
import { createUniqueId, Show, type JSX } from 'solid-js';
import History from 'lucide-solid/icons/history';
import MessageSquare from 'lucide-solid/icons/message-square';
import PanelRightClose from 'lucide-solid/icons/panel-right-close';
import PanelRightOpen from 'lucide-solid/icons/panel-right-open';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import { Button } from '@/solid/ui/Button';
import { Tabs } from '@/solid/ui/Tabs';
import { Tooltip } from '@/solid/ui/Tooltip';
import { EDIT_PANEL_STRIP_W, RIGHT_RAIL_W } from '@/lib/story-ui/edit-bar';

export type EditPanelTab = 'selection' | 'history' | 'comments';

const TABS = [
  { tab: 'selection' as const, label: 'Selection', Icon: SlidersHorizontal },
  { tab: 'history' as const, label: 'History', Icon: History },
  { tab: 'comments' as const, label: 'Comments', Icon: MessageSquare },
];

/** Shown in the Selection tab when nothing inspectable is selected. */

export default function EditPanel(props: {
  /** Where the panel starts: under the page's bar and the editor toolbar. */
  top: number;
  tab: EditPanelTab;
  onTab: (tab: EditPanelTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Something inspectable was selected while another tab was showing. */
  selectionDot: boolean;
  /** Only someone who may comment gets the Comments tab. */
  commentsAvailable: boolean;
  /** History is a backend capability; without it the tab stays, disabled, saying why. See DEVIATION above. */
  historyUnavailable?: string | null;
  /** The active tab's body. */
  children: JSX.Element;
}): JSX.Element {
  const id = createUniqueId();
  const items = () => TABS.filter((t) => t.tab !== 'comments' || props.commentsAvailable).map(({ tab, label, Icon }) => ({
    value: tab,
    label,
    icon: () => <Icon size={13} class="shrink-0" />,
    id: `${id}-${tab}`,
    controls: `${id}-body`,
    badge: tab === 'selection' && props.selectionDot ? (true as const) : undefined,
    disabled: !!unavailable(tab),
    disabledReason: unavailable(tab) ?? undefined,
  }));
  const unavailable = (t: EditPanelTab): string | null => (t === 'history' ? (props.historyUnavailable ?? null) : null);
  const tabs = (extra: { orientation?: 'vertical'; iconOnly?: boolean; class?: string }) => (
    <Tabs label="Edit panel tabs" variant="pill" size="sm" items={items()} value={props.tab} onChange={(t) => props.onTab(t as EditPanelTab)} {...extra} />
  );

  return (
    <Show
      when={!props.collapsed}
      fallback={
        <aside
          aria-label="Edit panel"
          class="fixed right-0 bottom-0 z-30 flex flex-col items-center gap-1 border-l border-edge bg-surface py-2"
          style={{ top: `${props.top}px`, width: `${EDIT_PANEL_STRIP_W}px` }}
        >
          <Tooltip content="Expand panel" side="left">
            <Button variant="ghost" size="sm" icon aria-label="Expand panel" aria-expanded="false" onClick={() => props.onCollapsedChange(false)}>
              <PanelRightOpen size={15} />
            </Button>
          </Tooltip>
          {tabs({ orientation: 'vertical', iconOnly: true, class: 'items-center border-t border-edge pt-1' })}
        </aside>
      }
    >
      <aside
        aria-label="Edit panel"
        class="fixed right-0 bottom-0 z-30 flex flex-col border-l border-edge bg-surface"
        style={{ top: `${props.top}px`, width: `${RIGHT_RAIL_W}px` }}
      >
        <div class="flex h-10 shrink-0 items-center gap-1 border-b border-edge px-2">
          {tabs({ class: 'min-w-0 flex-1 items-center' })}
          <Tooltip content="Collapse panel" side="bottom">
            <Button variant="ghost" size="sm" icon aria-label="Collapse panel" aria-expanded="true" onClick={() => props.onCollapsedChange(true)}>
              <PanelRightClose size={15} />
            </Button>
          </Tooltip>
        </div>
        <div role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${props.tab}`} class="flex min-h-0 flex-1 flex-col">
          {props.children}
        </div>
      </aside>
    </Show>
  );
}
