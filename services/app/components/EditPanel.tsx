'use client';

/**
 * THE EDIT PANEL — one right panel for the whole edit session, on a window
 * wide enough to hold it beside the document (lib/story/edit-bar's
 * EDIT_PANEL_BREAKPOINT; narrower windows get bottom sheets instead).
 *
 * Its width is decided when edit mode opens and nothing inside the session
 * changes it: selecting, deselecting, switching tabs and opening comments all
 * happen INSIDE a column that is already there, so the document never moves
 * under the pointer. Only collapsing or expanding changes the width: the
 * collapse button, or an explicit request to see a tab while collapsed (the
 * caller's call) — because only then did the person ask for it.
 *
 * The panel owns its frame — panel chooser, the dot, collapse — and nothing else. What
 * each tab shows is the caller's: the selection's inspector, the version list,
 * and a host element the comments rail renders into.
 */
import { History, MessageSquare, PanelRightClose, PanelRightOpen, SlidersHorizontal, Files, Users, Database, Settings } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { EDIT_PANEL_STRIP_W, RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export type EditPanelTab = 'selection' | 'files' | 'datasets' | 'sharing' | 'settings' | 'history' | 'comments';

const TABS = [
  { tab: 'selection', label: 'Selection', Icon: SlidersHorizontal },
  { tab: 'files', label: 'Files', Icon: Files },
  { tab: 'datasets', label: 'Dataset settings', Icon: Database },
  { tab: 'sharing', label: 'Sharing', Icon: Users },
  { tab: 'settings', label: 'Artifact settings', Icon: Settings },
  { tab: 'history', label: 'History', Icon: History },
  { tab: 'comments', label: 'Comments', Icon: MessageSquare },
] as const;

/** Shared chooser: rail on desktop, sheet launcher on narrow windows. */
export function EditPanelPicker({ value, onChange, commentsAvailable, selectionDot = false, compact = false }: {
  value: EditPanelTab | '';
  onChange: (tab: EditPanelTab) => void;
  commentsAvailable: boolean;
  selectionDot?: boolean;
  compact?: boolean;
}) {
  return <div className={`flex min-w-0 flex-1 items-center gap-2 ${compact ? 'max-w-24' : ''}`}>
    <select aria-label="Editor panel" value={value}
      onChange={event => onChange(event.target.value as EditPanelTab)}
      className="h-7 min-w-0 max-w-full cursor-pointer rounded-[4px] border border-edge bg-surface px-2 font-mono text-[11px] text-fg">
      <option value="" disabled>Panel…</option>
      {TABS.filter(item => item.tab !== 'comments' || commentsAvailable).map(item =>
        <option key={item.tab} value={item.tab}>{item.label}</option>)}
    </select>
    {selectionDot && <span aria-label="New selection available" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
  </div>;
}

/** Shown in the Selection tab when nothing inspectable is selected. */
export const SELECTION_HINT = 'Select a chart, image or block to see its settings.';

export default function EditPanel({
  top,
  tab,
  onTab,
  collapsed,
  onCollapsedChange,
  selectionDot,
  commentsAvailable,
  children,
}: {
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
  /** The active tab's body. */
  children: ReactNode;
}) {
  const id = useId();
  const tabs = TABS.filter((t) => t.tab !== 'comments' || commentsAvailable);
  const dot = (
    <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
  );

  if (collapsed) {
    return (
      <aside
        aria-label="Edit panel"
        className="fixed right-0 bottom-0 z-30 flex flex-col items-center gap-1 border-l border-edge bg-surface py-2"
        style={{ top, width: EDIT_PANEL_STRIP_W }}
      >
        <Tooltip content="Expand panel" positioning={{ placement: 'left' }}>
          <button
            type="button"
            aria-label="Expand panel"
            aria-expanded={false}
            onClick={() => onCollapsedChange(false)}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
          >
            <PanelRightOpen size={15} />
          </button>
        </Tooltip>
        <div role="tablist" aria-label="Edit panel tabs" aria-orientation="vertical" className="flex flex-col gap-1 border-t border-edge pt-1">
          {tabs.map(({ tab: t, label, Icon }) => (
            <Tooltip key={t} content={label} positioning={{ placement: 'left' }}>
              <button
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={tab === t}
                data-new-selection={t === 'selection' && selectionDot ? 'true' : undefined}
                onClick={() => onTab(t)}
                className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] ${
                  tab === t ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <Icon size={14} />
                {t === 'selection' && selectionDot && dot}
              </button>
            </Tooltip>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Edit panel"
      className="fixed right-0 bottom-0 z-30 flex flex-col border-l border-edge bg-surface"
      style={{ top, width: RIGHT_RAIL_W }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-edge px-2">
        <EditPanelPicker value={tab} onChange={onTab} commentsAvailable={commentsAvailable} selectionDot={selectionDot} />
        <Tooltip content="Collapse panel" positioning={{ placement: 'bottom-end' }}>
          <button
            type="button"
            aria-label="Collapse panel"
            aria-expanded={true}
            onClick={() => onCollapsedChange(true)}
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"
          >
            <PanelRightClose size={15} />
          </button>
        </Tooltip>
      </div>
      <div
        role="region"
        id={`${id}-body`}
        aria-label={TABS.find(item => item.tab === tab)?.label}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </aside>
  );
}
