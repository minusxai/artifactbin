/* @jsxImportSource solid-js */
/**
 * THE EDITING CHROME OF A LIVE REGION — what an editor's page draws while they edit a region of the document in its
 * frame (create-framed-story `regionUi`, fed by region-editing from the frame's editor):
 *
 *  - the TOOLBAR, under the app bar, while this person has a region editor: undo/redo, the text style, bold, italic,
 *    inline code, link, lists, quote, code block and indent, each reflecting the marks and block at the caret
 *    (`region-caret`), each named and showing its keyboard shortcut in its tooltip. Pressing a button leaves the caret
 *    in the editor (ui/Toolbar `keepFocus`); a text region (one plain line) offers undo and redo only.
 *  - the LINK dialog (the toolbar's Link, or Mod-K in the editor): a URL is refused here unless it is one a region may
 *    hold (lib/live-regions/href, the editor's and the server's own rule), then applied to the selection, the link at
 *    the caret, or inserted as linked text.
 *  - the SLASH MENU, opened by `/` at an empty block's start, at the caret: the focus moves to its filter, typing
 *    narrows it, arrows and Enter choose, Escape closes it and leaves the `/` where it is; choosing removes the `/`
 *    and runs the item's command.
 *
 * Commands go to the editor in the frame (region-editor commandOf); this module never touches the document itself.
 */
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, Show, type Accessor, type JSX } from 'solid-js';
import Bold from 'lucide-solid/icons/bold';
import Italic from 'lucide-solid/icons/italic';
import Code from 'lucide-solid/icons/code';
import Link from 'lucide-solid/icons/link';
import List from 'lucide-solid/icons/list';
import ListOrdered from 'lucide-solid/icons/list-ordered';
import Quote from 'lucide-solid/icons/quote';
import SquareCode from 'lucide-solid/icons/square-code';
import Undo2 from 'lucide-solid/icons/undo-2';
import Redo2 from 'lucide-solid/icons/redo-2';
import IndentIncrease from 'lucide-solid/icons/indent-increase';
import IndentDecrease from 'lucide-solid/icons/indent-decrease';
import { safeHref } from '@/lib/live-regions/href';
import { REGION_TOOLBAR_H } from '@/lib/html-reader/edit-bar';
import { Button } from '../ui/Button';
import { ComboboxList, createListNavigation } from '../ui/Combobox';
import { Field, Input } from '../ui/Field';
import { FloatingPanel } from '../ui/FloatingPanel';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { Toolbar, ToolbarSeparator } from '../ui/Toolbar';
import { Tooltip } from '../ui/Tooltip';
import type { RegionUi } from './create-framed-story';
import type { RegionToolbarState } from './region-editing';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** A ProseMirror key name (`Mod-Shift-8`) as this platform writes it: `⌘⇧8` or `Ctrl+Shift+8`. */
export function shortcutText(keys: string): string {
  const parts = keys.split('-');
  const key = parts.pop()!;
  const name = key.length === 1 ? key.toUpperCase() : key;
  if (MAC) return parts.map((part) => ({ Mod: '⌘', Shift: '⇧', Alt: '⌥' })[part] ?? part).join('') + name;
  return [...parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)), name].join('+');
}
/** The same keys for `aria-keyshortcuts` (`Meta+Shift+8` / `Control+Shift+8`). */
const ariaKeys = (keys: string) => keys.split('-').map((part) => (part === 'Mod' ? (MAC ? 'Meta' : 'Control') : part.length === 1 ? part.toUpperCase() : part)).join('+');

/** The text styles of the style picker, and the caret block each shows. */
const STYLES = [
  { value: 'paragraph', label: 'Normal text' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
];
const MORE_STYLES: Record<string, string> = { h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', code: 'Code block' };

function Command(props: { label: string; keys?: string; hint?: string; pressed?: boolean; onPress: () => void; children: JSX.Element }): JSX.Element {
  const tip = () => (props.keys ? `${props.label} (${shortcutText(props.keys)})` : props.hint ? `${props.label} (${props.hint})` : props.label);
  return <Tooltip content={tip()}>
    <Button variant="ghost" size="sm" icon aria-label={props.label} aria-keyshortcuts={props.keys ? ariaKeys(props.keys) : undefined} pressed={props.pressed} onClick={() => props.onPress()}>{props.children}</Button>
  </Tooltip>;
}

const focusSoon = (el: HTMLElement) => { const go = () => el.focus({ preventScroll: true }); queueMicrotask(() => { if (el.isConnected) go(); else setTimeout(go, 0); }); };

function LinkControl(props: { ui: RegionUi; state: Accessor<RegionToolbarState> }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [href, setHref] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  /** Opened from the editor (Mod-K): closing without a link goes back to the text. */
  let fromEditor = false;
  const show = (value: string, editor: boolean) => { fromEditor = editor; setHref(value); setError(null); setOpen(true); };
  createEffect(on(props.ui.link, (request) => { if (request) show(request.href ?? '', true); }));
  const close = (done: boolean) => {
    if (!open()) return;
    setOpen(false);
    props.ui.closeLink();
    if (!done && fromEditor) props.ui.command('resume');
  };
  const apply = () => {
    const safe = safeHref(href());
    if (!safe) { setError('Use an http, https or mailto link, or a path on this site.'); return; }
    props.ui.command('link', { href: safe });
    close(true);
  };
  const remove = () => { props.ui.command('link', { href: null }); close(true); };
  return <Popover open={open()} onOpenChange={(next) => (next ? show('', false) : close(false))} label="Link"
    trigger={(attrs) => <Tooltip content={`Link (${shortcutText('Mod-k')})`}>
      <Button ref={attrs.ref} aria-haspopup={attrs['aria-haspopup']} aria-expanded={attrs['aria-expanded']} variant="ghost" size="sm" icon aria-label="Link"
        aria-keyshortcuts={ariaKeys('Mod-k')} pressed={props.state().marks.includes('link')} onClick={() => (open() ? close(false) : show('', false))}><Link size={16} /></Button>
    </Tooltip>}>
    <form class="grid w-72 gap-3 p-3" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <Field label="Link URL" error={error()}>
        <Input size="sm" ref={focusSoon} value={href()} placeholder="https://" autocomplete="off" spellcheck={false}
          onInput={(event) => { setHref(event.currentTarget.value); setError(null); }} />
      </Field>
      <div class="flex justify-end gap-2">
        <Show when={props.state().marks.includes('link')}><Button type="button" variant="secondary" size="sm" onClick={remove}>Remove link</Button></Show>
        <Button type="submit" size="sm">Apply link</Button>
      </div>
    </form>
  </Popover>;
}

export function RegionToolbar(props: { ui: RegionUi; state: Accessor<RegionToolbarState> }): JSX.Element {
  const state = props.state;
  const run = (name: string, args?: Record<string, unknown>) => props.ui.command(name, args);
  const block = () => state().block;
  const mark = (name: string) => state().marks.includes(name);
  const styles = () => (MORE_STYLES[block()] ? [...STYLES, { value: block(), label: MORE_STYLES[block()]! }] : STYLES);
  const style = () => (STYLES.some((option) => option.value === block()) || MORE_STYLES[block()] ? block() : 'paragraph');
  const pickStyle = (value: string) => {
    if (value === block()) return;
    if (block() === 'code' || value === 'paragraph') run('paragraph');
    const level = /^h([1-6])$/.exec(value)?.[1];
    if (level) run('heading', { level: Number(level) });
  };
  return <Toolbar label="Formatting" keepFocus class="pointer-events-auto">
    <Command label="Undo" keys="Mod-z" onPress={() => run('undo')}><Undo2 size={16} /></Command>
    <Command label="Redo" keys="Mod-Shift-z" onPress={() => run('redo')}><Redo2 size={16} /></Command>
    <Show when={state().kind === 'rich'}>
      <ToolbarSeparator />
      <Tooltip content={`Text style (${shortcutText('Mod-Alt-0')}–3)`}>
        <Select ariaLabel="Text style" size="sm" class="w-36" options={styles()} value={style()} onChange={pickStyle} />
      </Tooltip>
      <ToolbarSeparator />
      <Command label="Bold" keys="Mod-b" pressed={mark('strong')} onPress={() => run('strong')}><Bold size={16} /></Command>
      <Command label="Italic" keys="Mod-i" pressed={mark('em')} onPress={() => run('em')}><Italic size={16} /></Command>
      <Command label="Inline code" keys="Mod-e" pressed={mark('code')} onPress={() => run('code')}><Code size={16} /></Command>
      <LinkControl ui={props.ui} state={state} />
      <ToolbarSeparator />
      <Command label="Bulleted list" keys="Mod-Shift-8" pressed={block() === 'bullet'} onPress={() => run('list', { type: block() === 'bullet' ? null : 'bullet' })}><List size={16} /></Command>
      <Command label="Numbered list" keys="Mod-Shift-7" pressed={block() === 'ordered'} onPress={() => run('list', { type: block() === 'ordered' ? null : 'ordered' })}><ListOrdered size={16} /></Command>
      <Command label="Quote" keys="Mod-Shift-9" pressed={block() === 'quote'} onPress={() => run('quote', { on: block() !== 'quote' })}><Quote size={16} /></Command>
      <Command label="Code block" hint="```" pressed={block() === 'code'} onPress={() => run('codeBlock', { on: block() !== 'code' })}><SquareCode size={16} /></Command>
      <ToolbarSeparator />
      <Command label="Decrease indent" keys="Shift-Tab" onPress={() => run('outdent')}><IndentDecrease size={16} /></Command>
      <Command label="Increase indent" keys="Tab" onPress={() => run('indent')}><IndentIncrease size={16} /></Command>
    </Show>
  </Toolbar>;
}

/** The slash menu's blocks: what each inserts (an editor command) and the words it is found by. */
export const SLASH_ITEMS: ReadonlyArray<{ id: string; label: string; words: string; command: [string, Record<string, unknown>?] }> = [
  { id: 'paragraph', label: 'Text', words: 'text paragraph plain normal', command: ['paragraph'] },
  { id: 'h1', label: 'Heading 1', words: 'heading title h1 large', command: ['heading', { level: 1 }] },
  { id: 'h2', label: 'Heading 2', words: 'heading subtitle h2 medium', command: ['heading', { level: 2 }] },
  { id: 'h3', label: 'Heading 3', words: 'heading h3 small', command: ['heading', { level: 3 }] },
  { id: 'bullet', label: 'Bulleted list', words: 'bullet list unordered ul', command: ['list', { type: 'bullet' }] },
  { id: 'ordered', label: 'Numbered list', words: 'numbered ordered list ol', command: ['list', { type: 'ordered' }] },
  { id: 'quote', label: 'Quote', words: 'quote blockquote citation', command: ['quote', { on: true }] },
  { id: 'code', label: 'Code block', words: 'code block pre snippet', command: ['codeBlock', { on: true }] },
  { id: 'rule', label: 'Divider', words: 'divider rule line separator hr', command: ['rule'] },
];
/** The items whose label or words hold every word typed, labels starting with the query first. */
export function slashMatches(query: string): typeof SLASH_ITEMS[number][] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = SLASH_ITEMS.filter((item) => words.every((word) => `${item.label} ${item.words}`.toLowerCase().includes(word)));
  const lead = query.trim().toLowerCase();
  return lead ? [...found].sort((a, b) => Number(!a.label.toLowerCase().startsWith(lead)) - Number(!b.label.toLowerCase().startsWith(lead))) : found;
}

const SLASH_WIDTH = 240;

export function SlashMenu(props: { ui: RegionUi; at: Accessor<{ left: number; top: number }> }): JSX.Element {
  const list = createUniqueId();
  const [query, setQuery] = createSignal('');
  const items = createMemo(() => slashMatches(query()));
  const nav = createListNavigation({ count: () => items().length, onSelect: (index) => choose(items()[index]!) });
  createEffect(on(items, (found) => nav.setActive(found.length ? 0 : -1)));
  const [place, setPlace] = createSignal({ left: 0, top: 0 });
  let panel: HTMLDivElement | undefined;
  /** Under the caret's line, inside the viewport; above the line when there is no room below. */
  const position = () => {
    const { left, top } = props.at();
    const height = panel?.offsetHeight ?? 0;
    const below = top + 4;
    setPlace({
      left: Math.max(8, Math.min(left, window.innerWidth - SLASH_WIDTH - 8)),
      top: height && below + height > window.innerHeight - 8 ? Math.max(8, top - 24 - height) : below,
    });
  };
  createEffect(on(props.at, position));
  // Again once drawn, when its height is known.
  onMount(() => { const frame = requestAnimationFrame(position); onCleanup(() => cancelAnimationFrame(frame)); });
  let done = false;
  const close = (back: boolean) => { if (done) return; done = true; props.ui.closeSlash(); if (back) props.ui.command('resume'); };
  const choose = (item: typeof SLASH_ITEMS[number]) => {
    if (done) return;
    done = true;
    props.ui.closeSlash();
    props.ui.command('removeSlash');
    props.ui.command(item.command[0], item.command[1]);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Backspace' && !query()) { event.preventDefault(); done = true; props.ui.closeSlash(); props.ui.command('removeSlash'); return; }
    if (event.key === 'Tab') return;
    if (nav.keyDown(event.key)) event.preventDefault();
  };
  // A press anywhere else on the page leaves the menu (and the `/`) as it is; so does a press back in the document.
  const away = (event: PointerEvent) => { if (panel && !event.composedPath().includes(panel)) close(false); };
  document.addEventListener('pointerdown', away, true);
  onCleanup(() => document.removeEventListener('pointerdown', away, true));
  return <FloatingPanel label="Insert block" position={place()} width={SLASH_WIDTH} ref={(el) => { panel = el; }}
    onFocusOut={(event) => { if (panel && !panel.contains(event.relatedTarget as Node | null)) close(false); }}>
    <div class="p-1.5">
      <Input size="sm" ref={focusSoon} role="combobox" aria-label="Filter blocks" aria-autocomplete="list" aria-expanded="true" aria-controls={list}
        aria-activedescendant={nav.active() >= 0 && nav.active() < items().length ? `${list}-${nav.active()}` : undefined}
        value={query()} placeholder="filter blocks" autocomplete="off" spellcheck={false}
        onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={onKeyDown} />
    </div>
    <ComboboxList id={list} label="Blocks" size="sm" options={items()} optionKey={(item) => item.id} active={nav.active()} onActive={nav.setActive} onSelect={choose}
      renderOption={(item) => <span>{item.label}</span>} status={items().length ? undefined : 'No block matches'} />
  </FloatingPanel>;
}

/** The toolbar under the app bar (and clear of an open comments rail), and the slash menu, while they apply. */
export function RegionEditingChrome(props: { ui: RegionUi; top: number; right: number }): JSX.Element {
  return <>
    <Show when={props.ui.toolbar()}>{(state) => (
      <div class="pointer-events-none fixed left-0 flex items-center justify-center px-2" style={{ top: `${props.top}px`, right: `${props.right}px`, height: `${REGION_TOOLBAR_H}px` }}>
        <RegionToolbar ui={props.ui} state={state} />
      </div>
    )}</Show>
    <Show when={props.ui.slash()}>{(at) => <SlashMenu ui={props.ui} at={at} />}</Show>
  </>;
}
