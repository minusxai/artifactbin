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
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AArrowDown, AArrowUp, AlignCenter, AlignJustify, AlignLeft, AlignRight,
  ArrowDownFromLine, ArrowDownToLine, ArrowLeftFromLine, ArrowLeftToLine,
  ArrowRightFromLine, ArrowRightToLine, ArrowUpFromLine, ArrowUpToLine,
  Baseline, Bold, ChevronDown, FoldHorizontal, Italic, Link2, Link2Off,
  MessageSquare, SlidersHorizontal, Trash2, Underline, UnfoldHorizontal,
} from 'lucide-react';

import {
  applyStoryColor, applyTypographyChoice, currentChoice, currentStoryColor,
  currentPaddingStep, currentSpacingStep, currentWidthStep,
  stepPaddingClass, stepSizeClass, stepSpacingClass, stepWidthClass,
} from '@/lib/data/story/typography';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { selectionToolbarPlan } from '@/lib/story/selection-toolbar';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import type { ComposableFormatEdit } from '@/lib/story/edit-compose';
import { Tooltip } from '@/components/Tooltip';
import { EDIT_BAR_H } from '@/lib/story/edit-bar';

/** First-paint geometry; ResizeObserver replaces it with the toolbar's real size. */
const TOOLBAR_FALLBACK_W = 408;
const PRIMARY_FALLBACK_H = 54;
const EXPANDED_FALLBACK_H = 84;
const VIEWPORT_INSET = 8;
const SELECTION_GAP = 8;

export interface StoryFormatToolbarProps {
  selection: StoryEditSelection | null;
  frameRef: { current: HTMLIFrameElement | null };
  compiledCss?: string | null;
  onApply: (path: string, edit: ComposableFormatEdit) => void;
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
  selection, frameRef, onApply, onApplyLink, onSelect, onDelete, onComment,
}: StoryFormatToolbarProps) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLinkDraft(null); setMoreOpen(false); }, [selection?.path]);
  useEffect(() => { if (linkDraft !== null) linkInputRef.current?.focus(); }, [linkDraft]);

  // The toolbar is content-sized, and the optional detail row changes both
  // dimensions. Measure it so centering and above/below placement stay exact.
  const boxRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState({ width: TOOLBAR_FALLBACK_W, height: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width <= 0 || height <= 0) return;
      setMeasuredSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selection?.path, moreOpen, linkDraft]);

  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 0 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!selection || typeof document === 'undefined') return null;
  /*
   * EVERY selection gets the toolbar; lib/story/selection-toolbar is the one
   * mapping from what is selected to what it offers. The breadcrumb, comment
   * and delete render unguarded (ALWAYS_OFFERED); the format vocabulary
   * follows the plan — a component's classes are render output, so an embed
   * gets none of the class algebra, and its own inspector opens beside this.
   */
  const plan = selectionToolbarPlan(selection);

  const box = frameRef.current?.getBoundingClientRect();
  const top = (box?.top ?? 0) + selection.rect.y;
  const selectionLeft = (box?.left ?? 0) + selection.rect.x;
  const cls = selection.className;

  const apply = (className: string) => onApply(selection.path, { className });
  const toggle = (group: 'weight' | 'fontStyle' | 'decoration', token: string) =>
    apply(applyTypographyChoice(cls, group, currentChoice(cls, group) === token ? null : token));

  /** Keeping focus in the document is what makes a format edit compose with typing. */
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const Chip = ({ label, on, children, onClick }: {
    label: string; on?: boolean; children: React.ReactNode; onClick: () => void;
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

  // Center over the selected element, then clamp to the viewport. This keeps
  // the relationship obvious without letting edge selections push controls
  // off-screen.
  const measuredH = measuredSize.height || (moreOpen ? EXPANDED_FALLBACK_H : PRIMARY_FALLBACK_H);
  const availableWidth = Math.max(0, viewportWidth - VIEWPORT_INSET * 2);
  const toolbarWidth = Math.min(measuredSize.width, availableWidth);
  const idealLeft = selectionLeft + selection.rect.width / 2 - toolbarWidth / 2;
  const maxLeft = Math.max(VIEWPORT_INSET, viewportWidth - toolbarWidth - VIEWPORT_INSET);
  const placedLeft = Math.min(Math.max(VIEWPORT_INSET, idealLeft), maxLeft);

  // Above when it clears the fixed app/edit bars; otherwise below, growing
  // away from the selection so the toolbar never hides what is being edited.
  const floor = EDIT_BAR_H + VIEWPORT_INSET;
  const yAbove = top - measuredH - SELECTION_GAP;
  const placedTop = yAbove >= floor ? yAbove : top + selection.rect.height + SELECTION_GAP;

  return createPortal(
    <div
      ref={boxRef}
      aria-label="Typography toolbar"
      onMouseDown={keepFocus}
      // min-w: the embed shape (breadcrumb + delete alone) is content-sized and
      // read as a cramped scrap next to the full format toolbar; a floor keeps
      // the two shapes reading as one control.
      className="fixed z-40 flex w-max min-w-60 max-w-[calc(100vw-16px)] flex-col items-start rounded-[5px] border border-edge bg-surface px-1 py-1 shadow-lg"
      style={{ top: placedTop, left: placedLeft }}
    >
      {/* Where this element sits, and a way up to its container. */}
      <div className="mb-1 flex min-h-5 w-full items-center border-b border-edge px-0.5 pb-1" aria-label="Selection breadcrumb">
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

      <div className="flex max-w-full flex-wrap items-center gap-y-1 gap-x-0.5" aria-label="Primary formatting controls">

      {plan.text && (
        <>
          <Chip label="Decrease font size" onClick={() => apply(stepSizeClass(cls, -1))}><AArrowDown size={13} /></Chip>
          <Chip label="Increase font size" onClick={() => apply(stepSizeClass(cls, 1))}><AArrowUp size={13} /></Chip>
          <Chip label="Toggle bold" on={currentChoice(cls, 'weight') === 'font-bold'} onClick={() => toggle('weight', 'font-bold')}><Bold size={13} /></Chip>
          <Chip label="Toggle italic" on={currentChoice(cls, 'fontStyle') === 'italic'} onClick={() => toggle('fontStyle', 'italic')}><Italic size={13} /></Chip>
          <Chip label="Toggle underline" on={currentChoice(cls, 'decoration') === 'underline'} onClick={() => toggle('decoration', 'underline')}><Underline size={13} /></Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
        </>
      )}

      {plan.format && (
        <>
      {([['text-left', AlignLeft, 'Align left'], ['text-center', AlignCenter, 'Align center'],
         ['text-right', AlignRight, 'Align right'], ['text-justify', AlignJustify, 'Align justify']] as const).map(([token, Icon, label]) => (
        <Chip
          key={token}
          label={label}
          on={currentChoice(cls, 'align') === token}
          onClick={() => apply(applyTypographyChoice(cls, 'align', currentChoice(cls, 'align') === token ? null : token))}
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
              <Chip label="Insert link" onClick={() => setLinkDraft('')}><Link2 size={13} /></Chip>
              <Chip label="Remove link" onClick={() => onApplyLink(selection.path, null)}><Link2Off size={13} /></Chip>
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
                onKeyDown={(e) => { if (e.key === 'Escape') setLinkDraft(null); }}
                placeholder="https://…"
                className="w-44 rounded-[3px] border border-edge bg-raised px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
              />
              <button type="submit" aria-label="Apply link" className="cursor-pointer rounded-[3px] px-1 font-mono text-[10px] text-accent hover:bg-raised">
                ok
              </button>
            </form>
          )}
        </>
      )}

      {/* Delete is UNCONDITIONAL (ALWAYS_OFFERED) — the divider only makes
          sense when format chips precede it. */}
      {plan.format && <span className="mx-0.5 h-4 w-px bg-edge" />}
      <Chip label="Delete element" onClick={onDelete}><Trash2 size={13} /></Chip>

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
        <div className="mt-1 flex max-w-full flex-wrap items-center gap-y-1 gap-x-0.5 border-t border-edge pt-1" aria-label="Spacing and width controls">
          <Chip label="Decrease space above" onClick={() => apply(stepSpacingClass(cls, 'above', -1))}><ArrowUpToLine size={13} /></Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentSpacingStep(cls, 'above') ?? '0') * 4}px</span>
          <Chip label="Increase space above" onClick={() => apply(stepSpacingClass(cls, 'above', 1))}><ArrowUpFromLine size={13} /></Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space below" onClick={() => apply(stepSpacingClass(cls, 'below', -1))}><ArrowDownToLine size={13} /></Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentSpacingStep(cls, 'below') ?? '0') * 4}px</span>
          <Chip label="Increase space below" onClick={() => apply(stepSpacingClass(cls, 'below', 1))}><ArrowDownFromLine size={13} /></Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space left" onClick={() => apply(stepPaddingClass(cls, 'left', -1))}><ArrowLeftToLine size={13} /></Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentPaddingStep(cls, 'left') ?? '0') * 4}px</span>
          <Chip label="Increase space left" onClick={() => apply(stepPaddingClass(cls, 'left', 1))}><ArrowLeftFromLine size={13} /></Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease space right" onClick={() => apply(stepPaddingClass(cls, 'right', -1))}><ArrowRightToLine size={13} /></Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentPaddingStep(cls, 'right') ?? '0') * 4}px</span>
          <Chip label="Increase space right" onClick={() => apply(stepPaddingClass(cls, 'right', 1))}><ArrowRightFromLine size={13} /></Chip>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          <Chip label="Decrease width" onClick={() => apply(stepWidthClass(cls, -1))}><FoldHorizontal size={13} /></Chip>
          <span className="min-w-[26px] text-center font-mono text-[10px] text-muted">{currentWidthStep(cls) ?? 'full'}</span>
          <Chip label="Increase width" onClick={() => apply(stepWidthClass(cls, 1))}><UnfoldHorizontal size={13} /></Chip>
        </div>
      )}
    </div>,
    document.body,
  );
}
