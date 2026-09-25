'use client';

/**
 * Format controls for whatever is selected in the document.
 *
 * The document is a separate document, in its own realm, and this toolbar has
 * no element from it — only the DESCRIPTION the document sent (its path, its
 * current classes, and where it is on screen). Everything shown here is derived
 * from that description through a pure class algebra (lib/data/story/typography),
 * and every change goes back as one message:
 * applied to the live element instantly, folded into the source to persist.
 *
 * Layout is independent of selection geometry: formatting occupies a stable
 * row beside selection context. The editor supplies history and insertion slots.
 */
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, Fragment } from 'react';
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownFromLine,
  ArrowDownToLine,
  ArrowLeftFromLine,
  ArrowLeftToLine,
  ArrowRightFromLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  Italic,
  Link2,
  Link2Off,
  MessageSquare,
  Trash2,
  Underline,
} from 'lucide-react';

import {
  applyStoryColor,
  applyTypographyChoice,
  currentChoice,
  currentStoryColor,
  currentPaddingStep,
  currentSpacingStep,
  stepPaddingClass,
  stepSizeClass,
  stepSpacingClass,
} from '@/lib/data/story/typography';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { selectionToolbarPlan } from '@/lib/story/selection-toolbar';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import type { ComposableFormatEdit } from '@/lib/story/edit-compose';
import { StoryToolbarMenu } from './StoryToolbarMenu';
import { Tooltip } from '@/components/Tooltip';
import { nodeName } from '@/lib/story-ui/node-names';


interface StoryFormatToolbarProps {
  artifactId?:string;
  selection: StoryEditSelection | null;
  frameRef?: { current: HTMLIFrameElement | null };
  runtimeRef?: DocumentRuntimeRef;
  compiledCss?: string | null;
  onApply: (path: string, edit: ComposableFormatEdit) => void;
  onApplyInline?: (tag: 'strong' | 'em' | 'u') => void;
  onAutoHeight?: () => void;
  historyControls?: ReactNode;
  insertionControls?: ReactNode;
  onApplyLink: (path: string, href: string | null) => void;
  onSelect: (path: string | null) => void;
  onDelete: () => void;
  /**
   * Leave a comment on the selected node. Present only for someone who may
   * (an owner or a named editor); absent, the control does not render.
   *
   * It lives in the breadcrumb row rather than among the format chips because
   * commenting is about WHICH NODE, not about how it looks — and the breadcrumb
   * is already the control that says which node. It is also the edit-mode half
   * of the same capability the view-mode selection bubble offers: same action,
   * different surface, because inside the editor a floating bubble over a live
   * range fights the caret.
   */
  onComment?: (selection: StoryEditSelection) => void;
}

export default function StoryFormatToolbar({
  artifactId, selection,
  onApply,
  onApplyLink,
  onApplyInline,
  onAutoHeight,
  historyControls,
  insertionControls,
  onSelect,
  onDelete,
  onComment,
}: StoryFormatToolbarProps) {
  const [people,setPeople]=useState<Array<{user_id:string;username:string}>>([]);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  useEffect(()=>{if(!artifactId||!linkDraft?.startsWith('@')){setPeople([]);return;}const abort=new AbortController();void fetch(`/api/my/artifacts/${encodeURIComponent(artifactId)}/members?query=${encodeURIComponent(linkDraft.slice(1))}`,{signal:abort.signal}).then(r=>r.ok?r.json():{people:[]}).then(r=>setPeople(r.people??[])).catch(()=>{});return()=>abort.abort();},[artifactId,linkDraft]);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  // A deep trail overflows on a phone: keep its end, the selected node, in view.
  const crumbsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const crumbs = crumbsRef.current;
    if (crumbs) crumbs.scrollLeft = crumbs.scrollWidth;
  }, [selection?.path]);

  useEffect(() => {
    setLinkDraft(null);
    setMoreOpen(false);
    setAlignmentOpen(false);
  }, [selection?.path]);
  useEffect(() => {
    if (linkDraft !== null) linkInputRef.current?.focus();
  }, [linkDraft]);

  if (!selection || typeof document === 'undefined') return null;
  /*
   * EVERY selection gets the toolbar; lib/story/selection-toolbar is the one
   * mapping from what is selected to what it offers. The breadcrumb, comment
   * and delete render unguarded (ALWAYS_OFFERED); the format vocabulary
   * follows the plan — a component's classes are render output, so an embed
   * gets none of the class algebra, and its own inspector opens beside this.
   */
  const plan = selectionToolbarPlan(selection);

  const cls = selection.className;

  const apply = (className: string) => onApply(selection.path, { className });
  const toggle = (group: 'weight' | 'fontStyle' | 'decoration', token: string) =>
    onApplyInline
      ? onApplyInline(group === 'weight' ? 'strong' : group === 'fontStyle' ? 'em' : 'u')
      : apply(applyTypographyChoice(cls, group, currentChoice(cls, group) === token ? null : token));

  /** Keeping focus in the document is what makes a format edit compose with typing. */
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const Chip = ({
    label,
    on,
    children,
    onClick,
  }: {
    label: string;
    on?: boolean | 'mixed';
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onMouseDown={keepFocus}
        onClick={onClick}
        className={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] ${
          on ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-raised'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );

  return (
    <div aria-label="Typography toolbar" className="flex h-9 min-w-0 flex-1 items-center rounded-lg bg-raised">
      {/* Where this element sits, and a way up to its container. */}
      <div
        className="flex h-8 max-w-[50%] shrink-0 items-center gap-1 border-r border-edge px-2"
        aria-label="Selection breadcrumb"
      >
        <div ref={crumbsRef} className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
          <button
            type="button"
            aria-label="Document options"
            onClick={() => onSelect(null)}
            className="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-raised"
          >
            Document
          </button>
          <span className="text-[11px] text-muted">{'>'}</span>
          {selection.ancestors.length > 0 && (
            <>
              {selection.ancestors.map((crumb) => (
                <Fragment key={crumb.path}>
                  <Tooltip content={crumb.hint || crumb.tag}>
                    <button
                      type="button"
                      aria-label={`Select ${nodeName(crumb.tag)}`}
                      onMouseDown={keepFocus}
                      onClick={() => onSelect(crumb.path)}
                      className="cursor-pointer rounded-[3px] px-1 text-[11px] text-muted hover:bg-raised hover:text-fg"
                    >
                      {nodeName(crumb.tag)}
                    </button>
                  </Tooltip>
                  <span className="text-[11px] text-muted">{'>'}</span>
                </Fragment>
              ))}
            </>
          )}
          <span className="shrink-0 px-1 text-[11px] text-accent">{nodeName(selection.tag)}</span>
        </div>
      </div>
      <div
        className="flex h-9 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2"
        aria-label="Primary formatting controls"
      >
        {historyControls}
        {historyControls && <span className="mx-1 h-4 w-px shrink-0 bg-edge" />}
        {onAutoHeight && selection.customHeight && (
          <>
            <span className="text-[11px] text-muted">Height: custom</span>
            <button
              type="button"
              aria-label="Auto height"
              onClick={onAutoHeight}
              className="rounded border border-edge px-1.5 py-1 text-[11px]"
            >
              Auto height
            </button>
          </>
        )}
        {plan.text && (
          <>
            <Chip label="Decrease font size" onClick={() => apply(stepSizeClass(cls, -1))}>
              <AArrowDown size={14} />
            </Chip>
            <Chip label="Increase font size" onClick={() => apply(stepSizeClass(cls, 1))}>
              <AArrowUp size={14} />
            </Chip>
            <Chip
              label="Toggle bold"
              on={selection.inline?.strong ?? currentChoice(cls, 'weight') === 'font-bold'}
              onClick={() => toggle('weight', 'font-bold')}
            >
              <Bold size={14} />
            </Chip>
            <Chip
              label="Toggle italic"
              on={selection.inline?.em ?? currentChoice(cls, 'fontStyle') === 'italic'}
              onClick={() => toggle('fontStyle', 'italic')}
            >
              <Italic size={14} />
            </Chip>
            <Chip
              label="Toggle underline"
              on={selection.inline?.u ?? currentChoice(cls, 'decoration') === 'underline'}
              onClick={() => toggle('decoration', 'underline')}
            >
              <Underline size={14} />
            </Chip>
            <span className="mx-0.5 h-4 w-px bg-edge" />
          </>
        )}

        {plan.format && (
          <>
            <StoryToolbarMenu label="Align" name="Alignment" open={alignmentOpen} onOpenChange={setAlignmentOpen}>
              <div className="flex" onClick={() => setAlignmentOpen(false)}>
                {(
                  [
                    ['text-left', AlignLeft, 'Align left'],
                    ['text-center', AlignCenter, 'Align center'],
                    ['text-right', AlignRight, 'Align right'],
                    ['text-justify', AlignJustify, 'Align justify'],
                  ] as const
                ).map(([token, Icon, label]) => (
                  <Chip
                    key={token}
                    label={label}
                    on={currentChoice(cls, 'align') === token}
                    onClick={() =>
                      apply(applyTypographyChoice(cls, 'align', currentChoice(cls, 'align') === token ? null : token))
                    }
                  >
                    <Icon size={14} />
                  </Chip>
                ))}
              </div>
            </StoryToolbarMenu>

            {plan.color && (<>
            <span className="mx-0.5 h-4 w-px bg-edge" />
            <Tooltip content="text color">
              <label
                aria-label="Text color"
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-fg hover:bg-raised"
              >
                <Baseline size={14} />
                <input
                  type="color"
                  aria-label="Pick text color"
                  value={currentStoryColor(cls, 'text') ?? '#000000'}
                  onChange={(e) => apply(applyStoryColor(cls, 'text', e.target.value))}
                  className="absolute h-0 w-0 opacity-0"
                />
              </label>
            </Tooltip>
            </>)}
          </>
        )}

        {/* Links live in the TEXT, so only the document can make one: it holds the
          live selection. This asks; the document answers with the new content. */}
        {plan.link && (
          <>
            <span className="mx-0.5 h-4 w-px bg-edge" />
            {linkDraft === null ? (
              <>
                <Chip label="Insert link" onClick={() => setLinkDraft('')}>
                  <Link2 size={14} />
                </Chip>
                {artifactId&&<Chip label="Mention person" onClick={()=>setLinkDraft('@')}>@</Chip>}
                <Chip label="Remove link" onClick={() => onApplyLink(selection.path, null)}>
                  <Link2Off size={14} />
                </Chip>
              </>
            ) : (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if(linkDraft.startsWith('@'))return;
                  const href = normalizeLinkHref(linkDraft);
                  if (href) onApplyLink(selection.path, href);
                  setLinkDraft(null);
                }}
              >
                <input
                  ref={linkInputRef}
                  aria-label="Link URL"
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setLinkDraft(null);
                  }}
                  placeholder="https://…"
                  className="w-44 rounded-[3px] border border-edge bg-raised px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
                />
                {linkDraft.startsWith('@')&&<div aria-label="People to mention" className="flex max-w-64 flex-wrap gap-1">{people.map(p=><button key={p.user_id} type="button" className="rounded-md bg-accent-soft px-2 py-1 text-xs text-accent" onMouseDown={e=>e.preventDefault()} onClick={()=>{onApplyLink(selection.path,`/people/${p.user_id}`);setLinkDraft(null);}}>@{p.username}</button>)}</div>}
                <button
                  type="submit"
                  aria-label="Apply link"
                  className="cursor-pointer rounded-[3px] px-1 font-mono text-[10px] text-accent hover:bg-raised"
                >
                  ok
                </button>
              </form>
            )}
          </>
        )}

        {/* ── Spacing row: margins above/below, padding left/right ────────────
          The same relative-stepper algebra as everything else (typography.ts):
          curated skip-step scales, variants shift in place, readouts show the
          bare step. */}
        {plan.format && (
          <StoryToolbarMenu label="Spacing" name="More formatting controls" open={moreOpen} onOpenChange={setMoreOpen}>
            <div className="flex flex-wrap items-center gap-0.5" aria-label="Spacing controls">
              <Chip label="Decrease space above" onClick={() => apply(stepSpacingClass(cls, 'above', -1))}>
                <ArrowUpToLine size={14} />
              </Chip>
              <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
                {Number(currentSpacingStep(cls, 'above') ?? '0') * 4}px
              </span>
              <Chip label="Increase space above" onClick={() => apply(stepSpacingClass(cls, 'above', 1))}>
                <ArrowUpFromLine size={14} />
              </Chip>
              <span className="mx-0.5 h-4 w-px bg-edge" />
              <Chip label="Decrease space below" onClick={() => apply(stepSpacingClass(cls, 'below', -1))}>
                <ArrowDownToLine size={14} />
              </Chip>
              <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
                {Number(currentSpacingStep(cls, 'below') ?? '0') * 4}px
              </span>
              <Chip label="Increase space below" onClick={() => apply(stepSpacingClass(cls, 'below', 1))}>
                <ArrowDownFromLine size={14} />
              </Chip>
              <span className="mx-0.5 h-4 w-px bg-edge" />
              <Chip label="Decrease space left" onClick={() => apply(stepPaddingClass(cls, 'left', -1))}>
                <ArrowLeftToLine size={14} />
              </Chip>
              <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
                {Number(currentPaddingStep(cls, 'left') ?? '0') * 4}px
              </span>
              <Chip label="Increase space left" onClick={() => apply(stepPaddingClass(cls, 'left', 1))}>
                <ArrowLeftFromLine size={14} />
              </Chip>
              <span className="mx-0.5 h-4 w-px bg-edge" />
              <Chip label="Decrease space right" onClick={() => apply(stepPaddingClass(cls, 'right', -1))}>
                <ArrowRightToLine size={14} />
              </Chip>
              <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
                {Number(currentPaddingStep(cls, 'right') ?? '0') * 4}px
              </span>
              <Chip label="Increase space right" onClick={() => apply(stepPaddingClass(cls, 'right', 1))}>
                <ArrowRightFromLine size={14} />
              </Chip>
              <span className="mx-0.5 h-4 w-px bg-edge" />
            </div>
          </StoryToolbarMenu>
        )}
        {insertionControls}
      </div>
      <div aria-label="Selection actions" className="ml-auto flex shrink-0 items-center gap-2 border-l border-edge px-2">
        {onComment && (
          <Tooltip content="comment on this (⌘⌥M)">
            <button
              type="button"
              aria-label="Comment on selection"
              onMouseDown={keepFocus}
              onClick={() => onComment(selection)}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-normal leading-none text-fg hover:bg-surface"
            >
              <MessageSquare size={11} />
              <span className="hidden sm:inline">Comment</span>
            </button>
          </Tooltip>
        )}
        <Chip label="Delete element" onClick={onDelete}>
          <Trash2 size={14} />
        </Chip>
      </div>
    </div>
  );
}
