/* @jsxImportSource solid-js */
/**
 * Format controls for whatever is selected
 * in the document. The toolbar holds no element from the document, only the DESCRIPTION it sent (its
 * path, its current classes, where it is on screen); every change goes back as one message.
 *
 * There is no artifact-backend context in the app (see solid/editor/EditPanel.tsx), so the toolbar takes
 * a narrow `backend` prop for two things — whether @mentions can be looked up, and the lookup itself:
 * `{ mentionsUnavailable: string | null; members?: (query: string, opts: { signal }) => Promise<{ people: [...] } | null> }`.
 * Whoever wires this toolbar into a live page passes the app's ArtifactBackend (it satisfies this
 * shape already — `unavailable('mentions')` and `members(...)`).
 */
import { createEffect, createSignal, createUniqueId, For, on, Show, type JSX } from 'solid-js';
import AArrowDown from 'lucide-solid/icons/a-arrow-down';
import AArrowUp from 'lucide-solid/icons/a-arrow-up';
import AlignCenter from 'lucide-solid/icons/align-center';
import AlignJustify from 'lucide-solid/icons/align-justify';
import AlignLeft from 'lucide-solid/icons/align-left';
import AlignRight from 'lucide-solid/icons/align-right';
import ArrowDownFromLine from 'lucide-solid/icons/arrow-down-from-line';
import ArrowDownToLine from 'lucide-solid/icons/arrow-down-to-line';
import ArrowLeftFromLine from 'lucide-solid/icons/arrow-left-from-line';
import ArrowLeftToLine from 'lucide-solid/icons/arrow-left-to-line';
import ArrowRightFromLine from 'lucide-solid/icons/arrow-right-from-line';
import ArrowRightToLine from 'lucide-solid/icons/arrow-right-to-line';
import ArrowUpFromLine from 'lucide-solid/icons/arrow-up-from-line';
import ArrowUpToLine from 'lucide-solid/icons/arrow-up-to-line';
import Baseline from 'lucide-solid/icons/baseline';
import Bold from 'lucide-solid/icons/bold';
import ImageUp from 'lucide-solid/icons/image-up';
import Italic from 'lucide-solid/icons/italic';
import Link2 from 'lucide-solid/icons/link-2';
import Link2Off from 'lucide-solid/icons/link-2-off';
import MessageSquare from 'lucide-solid/icons/message-square';
import Trash2 from 'lucide-solid/icons/trash-2';
import Underline from 'lucide-solid/icons/underline';

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
import { selectionToolbarPlan } from '@/lib/story/reader/selection-toolbar';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import type { ComposableFormatEdit } from '@/lib/document/edit-compose';
import { StoryToolbarMenu } from './StoryToolbarMenu';
import { Tooltip } from '@/solid/components/Tooltip';
import { nodeName } from '@/lib/story-ui/node-names';

interface ImageControls {
  /** The image's alt text; null when it has none (the button then hints). */
  alt: string | null;
  /** Open the "Replace image" dialog for this image. */
  onReplace: () => void;
  /** Commit new alt text; blank removes it. Called once per committed change. */
  onAlt: (alt: string) => void;
}

interface StoryFormatBackend {
  /** `backend.unavailable('mentions')`: null when @mentions can be looked up. */
  mentionsUnavailable: string | null;
  members?: (query: string, opts: { signal: AbortSignal }) => Promise<{ people: Array<{ user_id: string; username: string }> } | null>;
}

interface StoryFormatToolbarProps {
  /** Panel controls wrap into rows; the compact toolbar scrolls horizontally. */
  layout?: 'toolbar' | 'panel';
  artifactId?: string;
  selection: StoryEditSelection | null;
  onApply: (path: string, edit: ComposableFormatEdit) => void;
  onApplyInline?: (tag: 'strong' | 'em' | 'u') => void;
  onAutoHeight?: () => void;
  historyControls?: JSX.Element;
  insertionControls?: JSX.Element;
  onApplyLink: (path: string, href: string | null) => void;
  /** Open the page's link card at the caret instead of this toolbar's own address box. */
  onEditLink?: () => void;
  onSelect: (path: string | null) => void;
  onDelete: () => void;
  /** Leave a comment on the selected node. Present only for someone who may. */
  onComment?: (selection: StoryEditSelection) => void;
  /** What an `<img>` selection can do besides layout. */
  image?: ImageControls;
  /** See DEVIATION above; absent disables @mentions entirely (as if unavailable). */
  backend?: StoryFormatBackend;
}

function Chip(props: { label: string; on?: boolean | 'mixed'; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip content={props.label}>
      <button
        type="button"
        aria-label={props.label}
        aria-pressed={props.on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={props.onClick}
        class={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] ${
          props.on ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-raised'
        }`}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

export default function StoryFormatToolbar(props: StoryFormatToolbarProps): JSX.Element {
  const [people, setPeople] = createSignal<Array<{ user_id: string; username: string }>>([]);
  const [linkDraft, setLinkDraft] = createSignal<string | null>(null);
  const [alignmentOpen, setAlignmentOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [altDraft, setAltDraft] = createSignal<string | null>(null);
  let linkInput: HTMLInputElement | undefined;
  let crumbs: HTMLDivElement | undefined;
  const mentionsUnavailable = () => props.backend?.mentionsUnavailable ?? 'Not available.';
  const urlReason = createUniqueId();

  createEffect(on(() => props.selection?.path, () => { if (crumbs) crumbs.scrollLeft = crumbs.scrollWidth; }));
  createEffect(on(() => props.selection?.path, () => {
    setLinkDraft(null);
    setMoreOpen(false);
    setAlignmentOpen(false);
    setAltDraft(null);
  }, { defer: true }));
  createEffect(on(linkDraft, () => { if (linkDraft() !== null) linkInput?.focus(); }, { defer: true }));

  createEffect(() => {
    const draft = linkDraft();
    if (!props.artifactId || mentionsUnavailable() || !draft?.startsWith('@') || !props.backend?.members) { setPeople([]); return; }
    const abort = new AbortController();
    void props.backend.members(draft.slice(1), { signal: abort.signal }).then((r) => r ?? { people: [] }).then((r) => setPeople(r.people ?? [])).catch(() => {});
    return abort.abort();
  });

  const cls = () => props.selection?.className ?? '';
  const apply = (className: string) => props.onApply(props.selection!.path, { className });
  const toggle = (group: 'weight' | 'fontStyle' | 'decoration', token: string) =>
    props.onApplyInline
      ? props.onApplyInline(group === 'weight' ? 'strong' : group === 'fontStyle' ? 'em' : 'u')
      : apply(applyTypographyChoice(cls(), group, currentChoice(cls(), group) === token ? null : token));

  const commitAlt = () => {
    const draft = altDraft();
    if (draft === null || !props.image) return;
    if (draft.trim() !== (props.image.alt ?? '')) props.image.onAlt(draft);
    setAltDraft(null);
  };
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <Show when={props.selection}>
      {(selection) => {
        const plan = () => selectionToolbarPlan(selection());
        return (
          <div aria-label="Typography toolbar" class={props.layout === 'panel' ? 'flex min-w-0 flex-col gap-2' : 'flex h-9 min-w-0 flex-1 items-center rounded-lg bg-raised'}>
            <div
              class={props.layout === 'panel' ? 'flex h-8 min-w-0 max-w-full items-center gap-1' : 'flex h-8 max-w-[50%] shrink-0 items-center gap-1 border-r border-edge px-2'}
              aria-label="Selection breadcrumb"
            >
              <div ref={crumbs} class="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
                <button type="button" aria-label="Document options" onClick={() => props.onSelect(null)} class="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-raised">
                  Document
                </button>
                <span class="text-[11px] text-muted">{'>'}</span>
                <For each={selection().ancestors}>
                  {(crumb) => (
                    <>
                      <Tooltip content={crumb.hint || crumb.tag}>
                        <button type="button" aria-label={`Select ${nodeName(crumb.tag)}`} onMouseDown={keepFocus} onClick={() => props.onSelect(crumb.path)}
                          class="cursor-pointer rounded-[3px] px-1 text-[11px] text-muted hover:bg-raised hover:text-fg">
                          {nodeName(crumb.tag)}
                        </button>
                      </Tooltip>
                      <span class="text-[11px] text-muted">{'>'}</span>
                    </>
                  )}
                </For>
                <span class="shrink-0 px-1 text-[11px] text-accent">{nodeName(selection().tag)}</span>
              </div>
            </div>
            <div
              class={props.layout === 'panel' ? 'flex min-w-0 flex-wrap items-center gap-1 rounded-lg bg-raised p-2' : 'flex h-9 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2'}
              aria-label="Primary formatting controls"
            >
              {props.historyControls}
              <Show when={props.historyControls}><span class="mx-1 h-4 w-px shrink-0 bg-edge" /></Show>

              <Show when={props.onAutoHeight && selection().customHeight}>
                <span class="text-[11px] text-muted">Height: custom</span>
                <button type="button" aria-label="Auto height" onClick={props.onAutoHeight} class="rounded border border-edge px-1.5 py-1 text-[11px]">Auto height</button>
              </Show>

              <Show when={plan().text}>
                <Chip label="Decrease font size" onClick={() => apply(stepSizeClass(cls(), -1))}><AArrowDown size={14} /></Chip>
                <Chip label="Increase font size" onClick={() => apply(stepSizeClass(cls(), 1))}><AArrowUp size={14} /></Chip>
                <Chip label="Toggle bold" on={selection().inline?.strong ?? currentChoice(cls(), 'weight') === 'font-bold'} onClick={() => toggle('weight', 'font-bold')}><Bold size={14} /></Chip>
                <Chip label="Toggle italic" on={selection().inline?.em ?? currentChoice(cls(), 'fontStyle') === 'italic'} onClick={() => toggle('fontStyle', 'italic')}><Italic size={14} /></Chip>
                <Chip label="Toggle underline" on={selection().inline?.u ?? currentChoice(cls(), 'decoration') === 'underline'} onClick={() => toggle('decoration', 'underline')}><Underline size={14} /></Chip>
                <span class="mx-0.5 h-4 w-px bg-edge" />
              </Show>

              <Show when={plan().image && props.image}>
                {(image) => (
                  <>
                    <button type="button" aria-label="Replace image" onMouseDown={keepFocus} onClick={() => image().onReplace()}
                      class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-mono text-[11px] leading-none text-fg hover:bg-surface">
                      <ImageUp size={12} /><span class="hidden sm:inline">Replace</span>
                    </button>
                    <StoryToolbarMenu
                      label={image().alt === null ? 'Add alt text' : 'Alt text'}
                      hint={image().alt === null}
                      open={altDraft() !== null}
                      onOpenChange={(open) => setAltDraft(open ? (image().alt ?? '') : null)}
                    >
                      <div class="flex w-72 max-w-full gap-1.5">
                        <input
                          aria-label="Image alt text"
                          autofocus
                          ref={(el) => queueMicrotask(() => el.focus())}
                          value={altDraft() ?? ''}
                          placeholder="Describe the image for people who can't see it"
                          onInput={(e) => setAltDraft(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitAlt(); }
                            else if (e.key === 'Escape') { e.preventDefault(); setAltDraft(null); }
                          }}
                          class="min-w-0 flex-1 rounded-[4px] border border-edge bg-transparent px-1.5 py-1 text-[12px] text-fg focus:border-edge-bright focus:outline-none"
                        />
                        <button type="button" aria-label="Save alt text" onClick={commitAlt} class="cursor-pointer rounded-[4px] border border-edge px-2 py-1 font-mono text-[11px] text-fg hover:border-edge-bright hover:bg-raised">save</button>
                      </div>
                    </StoryToolbarMenu>
                    <span class="mx-0.5 h-4 w-px bg-edge" />
                  </>
                )}
              </Show>

              <Show when={plan().format}>
                <StoryToolbarMenu label="Align" name="Alignment" open={alignmentOpen()} onOpenChange={setAlignmentOpen}>
                  <div class="flex" onClick={() => setAlignmentOpen(false)}>
                    <For each={[
                      ['text-left', AlignLeft, 'Align left'],
                      ['text-center', AlignCenter, 'Align center'],
                      ['text-right', AlignRight, 'Align right'],
                      ['text-justify', AlignJustify, 'Align justify'],
                    ] as const}>
                      {([token, Icon, label]) => (
                        <Chip label={label} on={currentChoice(cls(), 'align') === token} onClick={() => apply(applyTypographyChoice(cls(), 'align', currentChoice(cls(), 'align') === token ? null : token))}>
                          <Icon size={14} />
                        </Chip>
                      )}
                    </For>
                  </div>
                </StoryToolbarMenu>

                <Show when={plan().color}>
                  <span class="mx-0.5 h-4 w-px bg-edge" />
                  <Tooltip content="text color">
                    <label aria-label="Text color" class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-fg hover:bg-raised">
                      <Baseline size={14} />
                      <input type="color" aria-label="Pick text color" value={currentStoryColor(cls(), 'text') ?? '#000000'}
                        onInput={(e) => apply(applyStoryColor(cls(), 'text', e.currentTarget.value))} class="absolute h-0 w-0 opacity-0" />
                    </label>
                  </Tooltip>
                </Show>
              </Show>

              <Show when={plan().link}>
                <span class="mx-0.5 h-4 w-px bg-edge" />
                <Show when={linkDraft() === null} fallback={
                  <form class="flex items-center gap-1" onSubmit={(e) => {
                    e.preventDefault();
                    const draft = linkDraft()!;
                    if (draft.startsWith('@')) return;
                    const href = normalizeLinkHref(draft);
                    if (href) props.onApplyLink(selection().path, href);
                    setLinkDraft(null);
                  }}>
                    <input ref={linkInput} aria-label="Link URL" value={linkDraft() ?? ''} onInput={(e) => setLinkDraft(e.currentTarget.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setLinkDraft(null); }} placeholder="https://…"
                      class="w-44 rounded-[3px] border border-edge bg-raised px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none" />
                    <Show when={linkDraft()?.startsWith('@')}>
                      <div aria-label="People to mention" class="flex max-w-64 flex-wrap gap-1">
                        <For each={people()}>
                          {(p) => (
                            <button type="button" class="rounded-md bg-accent-soft px-2 py-1 text-xs text-accent" onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { props.onApplyLink(selection().path, `/people/${p.user_id}`); setLinkDraft(null); }}>
                              @{p.username}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <button type="submit" aria-label="Apply link" class="cursor-pointer rounded-[3px] px-1 font-mono text-[10px] text-accent hover:bg-raised">ok</button>
                  </form>
                }>
                  <Chip label="Insert link" onClick={() => (props.onEditLink && selection().editor === 'prose' ? props.onEditLink() : setLinkDraft(''))}><Link2 size={14} /></Chip>
                  <Show when={props.artifactId}>
                    <Show when={!mentionsUnavailable()} fallback={
                      <span tabIndex={0} data-feature-unavailable="" class="inline-flex [&>:disabled]:pointer-events-none">
                        <button type="button" aria-label="Mention person" aria-describedby={urlReason} disabled
                          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-fg opacity-50">@</button>
                        <span id={urlReason} hidden>{mentionsUnavailable()}</span>
                      </span>
                    }>
                      <Chip label="Mention person" onClick={() => setLinkDraft('@')}>@</Chip>
                    </Show>
                  </Show>
                  <Chip label="Remove link" onClick={() => props.onApplyLink(selection().path, null)}><Link2Off size={14} /></Chip>
                </Show>
              </Show>

              <Show when={plan().format}>
                <StoryToolbarMenu label="Spacing" name="More formatting controls" open={moreOpen()} onOpenChange={setMoreOpen}>
                  <div class="flex flex-wrap items-center gap-0.5" aria-label="Spacing controls">
                    <Chip label="Decrease space above" onClick={() => apply(stepSpacingClass(cls(), 'above', -1))}><ArrowUpToLine size={14} /></Chip>
                    <span class="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentSpacingStep(cls(), 'above') ?? '0') * 4}px</span>
                    <Chip label="Increase space above" onClick={() => apply(stepSpacingClass(cls(), 'above', 1))}><ArrowUpFromLine size={14} /></Chip>
                    <span class="mx-0.5 h-4 w-px bg-edge" />
                    <Chip label="Decrease space below" onClick={() => apply(stepSpacingClass(cls(), 'below', -1))}><ArrowDownToLine size={14} /></Chip>
                    <span class="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentSpacingStep(cls(), 'below') ?? '0') * 4}px</span>
                    <Chip label="Increase space below" onClick={() => apply(stepSpacingClass(cls(), 'below', 1))}><ArrowDownFromLine size={14} /></Chip>
                    <span class="mx-0.5 h-4 w-px bg-edge" />
                    <Chip label="Decrease space left" onClick={() => apply(stepPaddingClass(cls(), 'left', -1))}><ArrowLeftToLine size={14} /></Chip>
                    <span class="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentPaddingStep(cls(), 'left') ?? '0') * 4}px</span>
                    <Chip label="Increase space left" onClick={() => apply(stepPaddingClass(cls(), 'left', 1))}><ArrowLeftFromLine size={14} /></Chip>
                    <span class="mx-0.5 h-4 w-px bg-edge" />
                    <Chip label="Decrease space right" onClick={() => apply(stepPaddingClass(cls(), 'right', -1))}><ArrowRightToLine size={14} /></Chip>
                    <span class="min-w-[26px] text-center font-mono text-[10px] text-muted">{Number(currentPaddingStep(cls(), 'right') ?? '0') * 4}px</span>
                    <Chip label="Increase space right" onClick={() => apply(stepPaddingClass(cls(), 'right', 1))}><ArrowRightFromLine size={14} /></Chip>
                    <span class="mx-0.5 h-4 w-px bg-edge" />
                  </div>
                </StoryToolbarMenu>
              </Show>
              {props.insertionControls}
            </div>
            <div aria-label="Selection actions" class={props.layout === 'panel' ? 'mt-1 flex items-center gap-2' : 'ml-auto flex shrink-0 items-center gap-2 border-l border-edge px-2'}>
              <Show when={props.onComment}>
                {(onComment) => (
                  <Tooltip content="comment on this (⌘⌥M)">
                    <button type="button" aria-label="Comment on selection" onMouseDown={keepFocus} onClick={() => onComment()(selection())}
                      class={props.layout === 'panel' ? 'inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[4px] border border-edge px-2.5 font-sans text-xs text-fg hover:border-edge-bright hover:bg-raised' : 'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-normal leading-none text-fg hover:bg-surface'}>
                      <MessageSquare size={14} /><span class={props.layout === 'panel' ? '' : 'hidden sm:inline'}>Comment</span>
                    </button>
                  </Tooltip>
                )}
              </Show>
              <Show when={props.layout === 'panel'} fallback={<Chip label="Delete element" onClick={props.onDelete}><Trash2 size={14} /></Chip>}>
                <Tooltip content="Delete selected block">
                  <button type="button" aria-label="Delete element" onMouseDown={keepFocus} onClick={props.onDelete}
                    class="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[4px] border border-edge px-2.5 font-sans text-xs text-muted hover:border-danger/40 hover:bg-raised hover:text-danger"><Trash2 size={14} />Delete</button>
                </Tooltip>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
