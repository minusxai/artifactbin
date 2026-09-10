'use client';

/**
 * Format controls for whatever is selected in the document.
 *
 * The document is a separate document, in its own realm, and this toolbar has
 * no element from it — only the DESCRIPTION the document sent (its path, its
 * current classes, and where it is on screen). Everything shown here is derived
 * from that description through the same pure class algebra the canvas toolbar
 * used (lib/data/story/typography), and every change goes back as one message:
 * applied to the live element instantly, folded into the source to persist.
 *
 * Positioning: the reported rect is in the FRAME's viewport, so the frame's own
 * box is added. That composes exactly, including while the document scrolls
 * itself — which it does, unlike the fixed-height canvas this replaces.
 */
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
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
  ChevronDown,
  Italic,
  Link2,
  Link2Off,
  MessageSquare,
  SlidersHorizontal,
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
import { Tooltip } from '@/components/Tooltip';

export interface StoryFormatToolbarProps {
  selection: StoryEditSelection | null;
  frameRef?: { current: HTMLIFrameElement | null };
  runtimeRef?: DocumentRuntimeRef;
  compiledCss?: string | null;
  onApply: (path: string, edit: ComposableFormatEdit) => void;
  onApplyInline?: (tag: 'strong' | 'em' | 'u') => void;
  onAutoHeight?: () => void;
  onPasteMarkdown?: () => void;
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
  selection,
  onApply,
  onApplyLink,
  onApplyInline,
  onAutoHeight,
  onPasteMarkdown,
  onSelect,
  onDelete,
  onComment,
}: StoryFormatToolbarProps) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLinkDraft(null);
    setMoreOpen(false);
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
        className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] ${
          on ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-raised'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );

  return (
    <div aria-label="Typography toolbar" onMouseDown={keepFocus} className="flex min-w-max items-center gap-2">
      {/* Where this element sits, and a way up to its container. */}
      <div className="flex shrink-0 items-center px-0.5" aria-label="Selection breadcrumb">
        <button
          type="button"
          aria-label="Document options"
          onClick={() => onSelect(null)}
          className="mr-1 rounded border border-edge px-1.5 py-1 text-xs"
        >
          Document
        </button>
        {selection.ancestors.length > 0 && (
          <>
            {selection.ancestors.slice(-2).map((crumb) => (
              <Tooltip key={crumb.path} content={crumb.hint || crumb.tag}>
                <button
                  type="button"
                  aria-label={`Select ${crumb.tag}`}
                  onMouseDown={keepFocus}
                  onClick={() => onSelect(crumb.path)}
                  className="cursor-pointer rounded-[3px] px-1 font-mono text-[10px] text-muted hover:bg-raised hover:text-fg"
                >
                  {crumb.tag}
                </button>
              </Tooltip>
            ))}
            <span className="px-0.5 font-mono text-[10px] text-muted">›</span>
          </>
        )}
        <span className="px-1 font-mono text-[10px] text-accent">{selection.tag}</span>
        {onComment && (
          <Tooltip content="comment on this (⌘⌥M)">
            <button
              type="button"
              aria-label="Comment on selection"
              onMouseDown={keepFocus}
              onClick={() => onComment(selection)}
              className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-[3px] px-1 py-0.5 font-mono text-[10px] text-muted hover:bg-raised hover:text-fg"
            >
              <MessageSquare size={11} />
              comment
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5" aria-label="Primary formatting controls">
        {onPasteMarkdown && (
          <button
            type="button"
            aria-label="Paste Markdown"
            onClick={onPasteMarkdown}
            className="rounded border border-edge px-1.5 py-1 text-xs"
          >
            Paste Markdown
          </button>
        )}
        {onAutoHeight && selection.customHeight && (
          <>
            <span className="text-xs text-muted">Height: custom</span>
            <button
              type="button"
              aria-label="Auto height"
              onClick={onAutoHeight}
              className="rounded border border-edge px-1.5 py-1 text-xs"
            >
              Auto height
            </button>
          </>
        )}
        {plan.text && (
          <>
            <Chip label="Decrease font size" onClick={() => apply(stepSizeClass(cls, -1))}>
              <AArrowDown size={13} />
            </Chip>
            <Chip label="Increase font size" onClick={() => apply(stepSizeClass(cls, 1))}>
              <AArrowUp size={13} />
            </Chip>
            <Chip
              label="Toggle bold"
              on={selection.inline?.strong ?? currentChoice(cls, 'weight') === 'font-bold'}
              onClick={() => toggle('weight', 'font-bold')}
            >
              <Bold size={13} />
            </Chip>
            <Chip
              label="Toggle italic"
              on={selection.inline?.em ?? currentChoice(cls, 'fontStyle') === 'italic'}
              onClick={() => toggle('fontStyle', 'italic')}
            >
              <Italic size={13} />
            </Chip>
            <Chip
              label="Toggle underline"
              on={selection.inline?.u ?? currentChoice(cls, 'decoration') === 'underline'}
              onClick={() => toggle('decoration', 'underline')}
            >
              <Underline size={13} />
            </Chip>
            <span className="mx-0.5 h-4 w-px bg-edge" />
          </>
        )}

        {plan.format && (
          <>
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
                <Icon size={13} />
              </Chip>
            ))}

            <span className="mx-0.5 h-4 w-px bg-edge" />
            <Tooltip content="text color">
              <label
                aria-label="Text color"
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-fg hover:bg-raised"
              >
                <Baseline size={13} />
                <input
                  type="color"
                  aria-label="Pick text color"
                  value={currentStoryColor(cls, 'text') ?? '#000000'}
                  onChange={(e) => apply(applyStoryColor(cls, 'text', e.target.value))}
                  className="absolute h-0 w-0 opacity-0"
                />
              </label>
            </Tooltip>
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
                  <Link2 size={13} />
                </Chip>
                <Chip label="Remove link" onClick={() => onApplyLink(selection.path, null)}>
                  <Link2Off size={13} />
                </Chip>
              </>
            ) : (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
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

        {/* Delete is UNCONDITIONAL (ALWAYS_OFFERED) — the divider only makes
          sense when format chips precede it. */}
        {plan.format && <span className="mx-0.5 h-4 w-px bg-edge" />}
        <Chip label="Delete element" onClick={onDelete}>
          <Trash2 size={13} />
        </Chip>

        {plan.format && (
          <>
            <span className="mx-0.5 h-4 w-px bg-edge" />
            <Tooltip content={moreOpen ? 'hide spacing controls' : 'show spacing controls'}>
              <button
                type="button"
                aria-label="More formatting controls"
                aria-expanded={moreOpen}
                onMouseDown={keepFocus}
                onClick={() => setMoreOpen((current) => !current)}
                className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-[3px] px-1.5 font-mono text-[10px] ${
                  moreOpen ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <SlidersHorizontal size={12} />
                more
                <ChevronDown size={10} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* ── Spacing row: margins above/below, padding left/right, width ──────
          The same relative-stepper algebra as everything else (typography.ts):
          curated skip-step scales, variants shift in place, readouts show the
          bare step. Width walks the max-w scale; `full` = unconstrained. */}
      {plan.format && moreOpen && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-edge pl-2" aria-label="Spacing controls">
          <Chip label="Decrease space above" onClick={() => apply(stepSpacingClass(cls, 'above', -1))}>
            <ArrowUpToLine size={13} />
          </Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
            {Number(currentSpacingStep(cls, 'above') ?? '0') * 4}px
          </span>
          <Chip label="Increase space above" onClick={() => apply(stepSpacingClass(cls, 'above', 1))}>
            <ArrowUpFromLine size={13} />
          </Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space below" onClick={() => apply(stepSpacingClass(cls, 'below', -1))}>
            <ArrowDownToLine size={13} />
          </Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
            {Number(currentSpacingStep(cls, 'below') ?? '0') * 4}px
          </span>
          <Chip label="Increase space below" onClick={() => apply(stepSpacingClass(cls, 'below', 1))}>
            <ArrowDownFromLine size={13} />
          </Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space left" onClick={() => apply(stepPaddingClass(cls, 'left', -1))}>
            <ArrowLeftToLine size={13} />
          </Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
            {Number(currentPaddingStep(cls, 'left') ?? '0') * 4}px
          </span>
          <Chip label="Increase space left" onClick={() => apply(stepPaddingClass(cls, 'left', 1))}>
            <ArrowLeftFromLine size={13} />
          </Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space right" onClick={() => apply(stepPaddingClass(cls, 'right', -1))}>
            <ArrowRightToLine size={13} />
          </Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">
            {Number(currentPaddingStep(cls, 'right') ?? '0') * 4}px
          </span>
          <Chip label="Increase space right" onClick={() => apply(stepPaddingClass(cls, 'right', 1))}>
            <ArrowRightFromLine size={13} />
          </Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
        </div>
      )}
    </div>
  );
}
