/* @jsxImportSource solid-js */
/**
 * THE EDITING CHROME OF A LIVE REGION (solid/document/RegionToolbar), against the region UI a framed story hands it
 * (create-framed-story `regionUi`): the toolbar follows the caret the frame's editor reports and sends its commands; the
 * link dialog refuses unsafe URLs; the slash menu filters, takes the keyboard and runs (or leaves) the `/`.
 */
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import type { RegionUi } from '../create-framed-story';
import type { RegionToolbarState } from '../region-editing';
import { RegionEditingChrome, shortcutText, slashMatches } from '../RegionToolbar';

afterEach(() => { document.body.innerHTML = ''; });

function chrome() {
  const [toolbar, setToolbar] = createSignal<RegionToolbarState | null>(null);
  const [slash, setSlash] = createSignal<{ regionId: string; left: number; top: number } | null>(null);
  const [link, setLink] = createSignal<{ regionId: string; href: string | null } | null>(null);
  const commands: Array<[string, Record<string, unknown>?]> = [];
  const ui: RegionUi = {
    toolbar, slash, link,
    command: (name, args) => { commands.push(args ? [name, args] : [name]); },
    closeSlash: vi.fn(() => setSlash(null)),
    closeLink: vi.fn(() => setLink(null)),
  };
  render(() => <RegionEditingChrome ui={ui} top={44} right={0} />);
  const state = (marks: string[], block: string, kind: 'rich' | 'text' = 'rich') => setToolbar({ regionId: 'notes', kind, marks, block });
  return { ui, commands, state, setToolbar, setSlash, setLink };
}
const bar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const button = (name: string) => within(bar()).getByRole('button', { name });

describe('the region toolbar', () => {
  it('shows only while this person has a region editor, and every control is named', () => {
    const page = chrome();
    expect(screen.queryByRole('toolbar')).toBeNull();
    page.state([], 'paragraph');
    for (const name of ['Undo', 'Redo', 'Bold', 'Italic', 'Inline code', 'Link', 'Bulleted list', 'Numbered list', 'Quote', 'Code block', 'Decrease indent', 'Increase indent'])
      expect(button(name)).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Text style' })).toHaveTextContent('Normal text');
    page.setToolbar(null);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('reflects the marks and block at the caret as the editor moves', () => {
    const page = chrome();
    page.state(['strong', 'link'], 'h2');
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Italic')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Link')).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar()).getByRole('button', { name: 'Text style' })).toHaveTextContent('Heading 2');
    page.state(['em', 'code'], 'bullet');
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Italic')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Inline code')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Bulleted list')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Numbered list')).toHaveAttribute('aria-pressed', 'false');
    expect(within(bar()).getByRole('button', { name: 'Text style' })).toHaveTextContent('Normal text');
    page.state([], 'quote');
    expect(button('Quote')).toHaveAttribute('aria-pressed', 'true');
    page.state([], 'code');
    expect(button('Code block')).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar()).getByRole('button', { name: 'Text style' })).toHaveTextContent('Code block');
  });

  it('sends each control\'s command, toggling what the caret already has, and keeps the editor\'s focus on a press', () => {
    const page = chrome();
    page.state(['strong'], 'bullet');
    for (const name of ['Bold', 'Italic', 'Inline code', 'Undo', 'Redo', 'Bulleted list', 'Numbered list', 'Quote', 'Code block', 'Increase indent', 'Decrease indent']) fireEvent.click(button(name));
    expect(page.commands).toEqual([
      ['strong'], ['em'], ['code'], ['undo'], ['redo'],
      ['list', { type: null }], ['list', { type: 'ordered' }], ['quote', { on: true }], ['codeBlock', { on: true }], ['indent'], ['outdent'],
    ]);
    // Pressing a plain button leaves the focus in the editor (its default is prevented).
    expect(fireEvent.mouseDown(button('Bold'))).toBe(false);
    page.state([], 'code');
    page.commands.length = 0;
    fireEvent.click(button('Code block'));
    expect(page.commands).toEqual([['codeBlock', { on: false }]]);
  });

  it('the text style picker sets a heading level, and back to normal text', () => {
    const page = chrome();
    page.state([], 'paragraph');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Text style' }));
    fireEvent.click(screen.getByRole('option', { name: 'Heading 1' }));
    expect(page.commands).toEqual([['heading', { level: 1 }]]);
    page.state([], 'h1');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Text style' }));
    fireEvent.click(screen.getByRole('option', { name: 'Normal text' }));
    // From a code block a heading needs a paragraph first.
    page.state([], 'code');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Text style' }));
    fireEvent.click(screen.getByRole('option', { name: 'Heading 3' }));
    expect(page.commands).toEqual([['heading', { level: 1 }], ['paragraph'], ['paragraph'], ['heading', { level: 3 }]]);
  });

  it('shows each control\'s keyboard shortcut in its tooltip and names it to assistive tech', async () => {
    const page = chrome();
    page.state([], 'paragraph');
    expect(shortcutText('Mod-Shift-8')).toBe('Ctrl+Shift+8');
    for (const [name, keys] of [['Bold', 'Control+B'], ['Italic', 'Control+I'], ['Inline code', 'Control+E'], ['Link', 'Control+K'], ['Bulleted list', 'Control+Shift+8'], ['Numbered list', 'Control+Shift+7'], ['Quote', 'Control+Shift+9'], ['Undo', 'Control+Z']] as const)
      expect(button(name)).toHaveAttribute('aria-keyshortcuts', keys);
    fireEvent.focus(button('Bold'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Bold (Ctrl+B)'));
    fireEvent.blur(button('Bold'));
    fireEvent.focus(button('Numbered list'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Numbered list (Ctrl+Shift+7)'));
  });

  it('a text region (one plain line) offers undo and redo only', () => {
    const page = chrome();
    page.state([], 'paragraph', 'text');
    expect(within(bar()).getAllByRole('button').map((control) => control.getAttribute('aria-label'))).toEqual(['Undo', 'Redo']);
  });
});

describe('the link dialog', () => {
  it('clearing an existing link URL and applying removes it', async () => {
    const page = chrome();
    page.state(['link'], 'paragraph');
    page.setLink({ regionId: 'notes', href: 'https://example.com/qa' });
    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    fireEvent.input(field, { target: { value: '   ' } });
    fireEvent.submit(field.closest('form')!);
    expect(page.commands).toEqual([['link', { href: null }]]);
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull();
  });

  it('refuses a URL a region may not hold, and applies a safe one', async () => {
    const page = chrome();
    page.state([], 'paragraph');
    fireEvent.click(button('Link'));
    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    await waitFor(() => expect(field).toHaveFocus());
    for (const unsafe of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      fireEvent.input(field, { target: { value: unsafe } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
      expect(screen.getByText('Use an http, https or mailto link, or a path on this site.')).toBeVisible();
    }
    expect(page.commands).toEqual([]);
    fireEvent.input(field, { target: { value: ' https://a.example/x ' } });
    fireEvent.submit(field.closest('form')!);
    expect(page.commands).toEqual([['link', { href: 'https://a.example/x' }]]);
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull();
  });

  it('Mod-K in the editor opens it with the link at the caret; Remove link unlinks; closing it unused returns to the text', async () => {
    const page = chrome();
    page.state(['link'], 'paragraph');
    page.setLink({ regionId: 'notes', href: 'https://b.example/' });
    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    expect(field).toHaveValue('https://b.example/');
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(page.commands).toEqual([['link', { href: null }]]);
    expect(page.ui.closeLink).toHaveBeenCalled();
    page.setLink({ regionId: 'notes', href: null });
    await screen.findByRole('textbox', { name: 'Link URL' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull());
    expect(page.commands.at(-1)).toEqual(['resume']);
  });
});

describe('the slash menu', () => {
  it('finds blocks by any of their words', () => {
    expect(slashMatches('').map((item) => item.label)).toEqual(['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Quote', 'Code block', 'Divider']);
    expect(slashMatches('head').map((item) => item.label)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    expect(slashMatches('list').map((item) => item.label)).toEqual(['Bulleted list', 'Numbered list']);
    expect(slashMatches('ol').map((item) => item.label)).toEqual(['Numbered list']);
    expect(slashMatches('zzz')).toEqual([]);
  });

  it('opens at the caret with its filter focused, filters as the person types, and chooses with arrows and Enter: the `/` goes, the block comes', async () => {
    const page = chrome();
    page.state([], 'paragraph');
    page.setSlash({ regionId: 'notes', left: 120, top: 300 });
    const menu = await screen.findByRole('dialog', { name: 'Insert block' });
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('304px');
    const filter = within(menu).getByRole('combobox', { name: 'Filter blocks' });
    await waitFor(() => expect(filter).toHaveFocus());
    expect(within(menu).getAllByRole('option')).toHaveLength(9);
    fireEvent.input(filter, { target: { value: 'head' } });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    expect(within(menu).getByRole('option', { name: 'Heading 1' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    expect(within(menu).getByRole('option', { name: 'Heading 2' })).toHaveAttribute('aria-selected', 'true');
    expect(filter.getAttribute('aria-activedescendant')).toBe(within(menu).getByRole('option', { name: 'Heading 2' }).id);
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(page.commands).toEqual([['removeSlash'], ['heading', { level: 2 }]]);
    expect(screen.queryByRole('dialog', { name: 'Insert block' })).toBeNull();
  });

  it('Escape closes it and leaves the `/`, back in the text; a click on an item chooses it', async () => {
    const page = chrome();
    page.state([], 'paragraph');
    page.setSlash({ regionId: 'notes', left: 10, top: 10 });
    const filter = await screen.findByRole('combobox', { name: 'Filter blocks' });
    fireEvent.input(filter, { target: { value: 'quo' } });
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(page.commands).toEqual([['resume']]);
    expect(screen.queryByRole('dialog', { name: 'Insert block' })).toBeNull();
    page.setSlash({ regionId: 'notes', left: 10, top: 10 });
    fireEvent.click(await screen.findByRole('option', { name: 'Divider' }));
    expect(page.commands).toEqual([['resume'], ['removeSlash'], ['rule']]);
    page.setSlash({ regionId: 'notes', left: 10, top: 10 });
    const empty = await screen.findByRole('combobox', { name: 'Filter blocks' });
    fireEvent.input(empty, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No block matches')).toBeVisible();
    fireEvent.keyDown(empty, { key: 'Enter' });
    expect(page.commands).toHaveLength(3);
  });
});
