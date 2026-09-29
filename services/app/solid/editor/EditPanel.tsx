/* @jsxImportSource solid-js */
/**
 * components/EditPanel.tsx in SOLID — one right panel for the whole edit session, on a window wide
 * enough to hold it beside the document (lib/story/edit-bar's EDIT_PANEL_BREAKPOINT; narrower windows
 * get bottom sheets instead).
 *
 * Same frame as the React panel: tabs, the dot, collapse. What each tab shows is the caller's.
 *
 * DEVIATION: the React panel reads `useArtifactBackend().unavailable('versions')` from context; Solid
 * has no equivalent context yet (the app's artifact-backend boundary is still React-only), so this
 * takes `historyUnavailable` as an explicit prop. Whoever wires this panel into a live page passes
 * `backend.unavailable('versions')`.
 */
import { createUniqueId, For, Show, type JSX } from 'solid-js';
import History from 'lucide-solid/icons/history';
import MessageSquare from 'lucide-solid/icons/message-square';
import PanelRightClose from 'lucide-solid/icons/panel-right-close';
import PanelRightOpen from 'lucide-solid/icons/panel-right-open';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import { Tooltip } from '@/solid/components/Tooltip';
import { EDIT_PANEL_STRIP_W, RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export type EditPanelTab = 'selection' | 'history' | 'comments';

const TABS = [
  { tab: 'selection' as const, label: 'Selection', Icon: SlidersHorizontal },
  { tab: 'history' as const, label: 'History', Icon: History },
  { tab: 'comments' as const, label: 'Comments', Icon: MessageSquare },
];

/** Shown in the Selection tab when nothing inspectable is selected. */
export const SELECTION_HINT = 'Select a chart, image or block to see its settings.';

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
  const tabs = () => TABS.filter((t) => t.tab !== 'comments' || props.commentsAvailable);
  const unavailable = (t: EditPanelTab): string | null => (t === 'history' ? (props.historyUnavailable ?? null) : null);
  const dot = <span aria-hidden="true" class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />;

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
            <button
              type="button"
              aria-label="Expand panel"
              aria-expanded="false"
              onClick={() => props.onCollapsedChange(false)}
              class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
            >
              <PanelRightOpen size={15} />
            </button>
          </Tooltip>
          <div role="tablist" aria-label="Edit panel tabs" aria-orientation="vertical" class="flex flex-col gap-1 border-t border-edge pt-1">
            <For each={tabs()}>
              {({ tab: t, label, Icon }) => {
                const reason = () => unavailable(t);
                const button = (
                  <button
                    type="button"
                    role="tab"
                    aria-label={label}
                    aria-selected={props.tab === t}
                    data-new-selection={t === 'selection' && props.selectionDot ? 'true' : undefined}
                    disabled={!!reason() || undefined}
                    aria-describedby={reason() ? `${id}-${t}-reason` : undefined}
                    onClick={() => props.onTab(t)}
                    class={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] disabled:cursor-default disabled:opacity-50 ${
                      props.tab === t ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                    }`}
                  >
                    <Icon size={14} />
                    {t === 'selection' && props.selectionDot && dot}
                  </button>
                );
                return (
                  <>
                    <Show when={reason()} fallback={<Tooltip content={label} side="left">{button}</Tooltip>}>
                      {button}
                    </Show>
                    <Show when={reason()}>{(text) => <span id={`${id}-${t}-reason`} hidden>{text()}</span>}</Show>
                  </>
                );
              }}
            </For>
          </div>
        </aside>
      }
    >
      <aside
        aria-label="Edit panel"
        class="fixed right-0 bottom-0 z-30 flex flex-col border-l border-edge bg-surface"
        style={{ top: `${props.top}px`, width: `${RIGHT_RAIL_W}px` }}
      >
        <div class="flex h-10 shrink-0 items-center gap-1 border-b border-edge px-2">
          <div role="tablist" aria-label="Edit panel tabs" class="flex min-w-0 flex-1 items-center gap-0.5">
            <For each={tabs()}>
              {({ tab: t, label, Icon }) => {
                const reason = () => unavailable(t);
                return (
                  <>
                    <button
                      type="button"
                      role="tab"
                      id={`${id}-${t}`}
                      aria-label={label}
                      aria-selected={props.tab === t}
                      aria-controls={`${id}-body`}
                      data-new-selection={t === 'selection' && props.selectionDot ? 'true' : undefined}
                      disabled={!!reason() || undefined}
                      aria-describedby={reason() ? `${id}-${t}-reason` : undefined}
                      onClick={() => props.onTab(t)}
                      class={`relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[4px] px-2 font-mono text-[11px] disabled:cursor-default disabled:opacity-50 ${
                        props.tab === t ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                      }`}
                    >
                      <Icon size={13} class="shrink-0" />
                      <span>{label}</span>
                      {t === 'selection' && props.selectionDot && dot}
                    </button>
                    <Show when={reason()}>{(text) => <span id={`${id}-${t}-reason`} hidden>{text()}</span>}</Show>
                  </>
                );
              }}
            </For>
          </div>
          <Tooltip content="Collapse panel" side="bottom">
            <button
              type="button"
              aria-label="Collapse panel"
              aria-expanded="true"
              onClick={() => props.onCollapsedChange(true)}
              class="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
            >
              <PanelRightClose size={15} />
            </button>
          </Tooltip>
        </div>
        <div role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${props.tab}`} class="flex min-h-0 flex-1 flex-col">
          {props.children}
        </div>
      </aside>
    </Show>
  );
}
