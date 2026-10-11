/* @jsxImportSource solid-js */
/** The form and chrome controls: role, accessible name, keyboard and state for each primitive. */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Button } from '../Button';
import { Field, Input, SearchField, Textarea } from '../Field';
import { Checkbox, Switch } from '../Checkbox';
import { Tabs } from '../Tabs';
import { StatusMessage } from '../StatusMessage';
import { Panel } from '../Panel';
import { PageHeader, SectionHeading } from '../PageHeader';
import { Badge } from '../ui';

it('renders every Button variant as a native button that passes its props through', () => {
  const onClick = vi.fn();
  render(() => <form onSubmit={(event) => event.preventDefault()}>
    {(['primary', 'secondary', 'danger', 'ghost', 'link'] as const).map((variant) => <Button variant={variant} aria-label={`${variant} action`} data-kind={variant} onClick={onClick}>{variant}</Button>)}
    <Button type="submit" disabled>Save</Button>
    <Button size="sm" icon aria-label="Close panel">×</Button>
  </form>);
  for (const variant of ['primary', 'secondary', 'danger', 'ghost', 'link']) {
    const button = screen.getByRole('button', { name: `${variant} action` });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('data-kind', variant);
    expect(button).not.toHaveAttribute('variant');
    fireEvent.click(button);
  }
  expect(onClick).toHaveBeenCalledTimes(5);
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toHaveAttribute('type', 'submit');
  expect(save).toBeDisabled();
  expect(save.className).toContain('disabled:opacity-50');
  expect(screen.getByRole('button', { name: 'primary action' }).className).toContain('h-control');
  const icon = screen.getByRole('button', { name: 'Close panel' });
  expect(icon.className).toContain('size-control-sm');
  expect(icon).not.toHaveAttribute('size');
  expect(icon).not.toHaveAttribute('icon');
});

it('keeps a caller class for layout alongside the variant', () => {
  render(() => <Button class="w-full">Wide</Button>);
  expect(screen.getByRole('button', { name: 'Wide' }).className).toMatch(/\bw-full\b.*|.*\bw-full\b/);
  expect(screen.getByRole('button', { name: 'Wide' }).className).toContain('bg-action');
});

it('wires a Field label, hint and error to its control', () => {
  const [error, setError] = createSignal<string | null>(null);
  render(() => <Field label="Email" hint="We never share it" error={error()}><Input type="email" /></Field>);
  const input = screen.getByRole('textbox', { name: 'Email' });
  expect(input).toHaveAccessibleDescription('We never share it');
  expect(input).not.toHaveAttribute('aria-invalid');
  setError('Enter an email address');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('We never share it Enter an email address');
});

it('labels a Textarea through its Field and passes native props through', () => {
  const onInput = vi.fn();
  render(() => <Field label="Notes"><Textarea rows={3} onInput={onInput} /></Field>);
  const notes = screen.getByRole('textbox', { name: 'Notes' });
  expect(notes.tagName).toBe('TEXTAREA');
  expect(notes).toHaveAttribute('rows', '3');
  fireEvent.input(notes, { target: { value: 'hi' } });
  expect(onInput).toHaveBeenCalled();
});

it('reports SearchField input and clears it on Escape when asked', () => {
  const [value, setValue] = createSignal('');
  render(() => <SearchField label="Search people" value={value()} onValue={setValue} clearOnEscape />);
  const box = screen.getByRole('searchbox', { name: 'Search people' });
  fireEvent.input(box, { target: { value: 'zoe' } });
  expect(value()).toBe('zoe');
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(value()).toBe('');
});

it('toggles a Checkbox through its label', () => {
  const onChange = vi.fn();
  render(() => <Checkbox label="Likes and follows" checked={false} onChange={onChange} />);
  const box = screen.getByRole('checkbox', { name: 'Likes and follows' });
  expect(box).not.toBeChecked();
  fireEvent.click(screen.getByText('Likes and follows'));
  expect(onChange).toHaveBeenCalledWith(true);
});

it('toggles a Switch and reports its state', () => {
  const [on, setOn] = createSignal(false);
  render(() => <Switch label="Allow installation" checked={on()} onChange={setOn} />);
  const toggle = screen.getByRole('switch', { name: 'Allow installation' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(on()).toBe(true);
  expect(toggle).toBeChecked();
});

it('moves between Tabs with the arrow keys, Home and End, skipping disabled tabs', () => {
  const [value, setValue] = createSignal('csv');
  const items = [{ value: 'csv', label: 'CSV' }, { value: 'sheet', label: 'Sheets', disabled: true }, { value: 'json', label: 'JSON' }, { value: 'pg', label: 'PostgreSQL' }];
  render(() => <Tabs label="Source" items={items} value={value()} onChange={setValue} />);
  expect(screen.getByRole('tablist', { name: 'Source' })).toBeInTheDocument();
  const tab = (name: string) => screen.getByRole('tab', { name });
  expect(tab('CSV')).toHaveAttribute('aria-selected', 'true');
  expect(tab('CSV')).toHaveAttribute('tabindex', '0');
  expect(tab('JSON')).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(tab('CSV'), { key: 'ArrowRight' });
  expect(value()).toBe('json');
  expect(document.activeElement).toBe(tab('JSON'));
  fireEvent.keyDown(tab('JSON'), { key: 'End' });
  expect(value()).toBe('pg');
  fireEvent.keyDown(tab('PostgreSQL'), { key: 'ArrowRight' });
  expect(value()).toBe('csv');
  fireEvent.keyDown(tab('CSV'), { key: 'ArrowLeft' });
  expect(value()).toBe('pg');
  fireEvent.keyDown(tab('PostgreSQL'), { key: 'Home' });
  expect(value()).toBe('csv');
  fireEvent.click(tab('JSON'));
  expect(tab('JSON')).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(tab('Sheets'));
  expect(value()).toBe('json');
});

it('announces StatusMessage as status, or as an alert for an error', () => {
  render(() => <>
    <StatusMessage kind="loading">Loading group…</StatusMessage>
    <StatusMessage kind="empty">No people match your search.</StatusMessage>
    <StatusMessage kind="notice">Saved</StatusMessage>
    <StatusMessage kind="error" action={<Button variant="link">Retry group</Button>}>This group is unavailable.</StatusMessage>
  </>);
  expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual(['Loading group…', 'No people match your search.', 'Saved']);
  expect(screen.getByRole('alert')).toHaveTextContent('This group is unavailable.');
  expect(screen.getByRole('alert')).toContainElement(screen.getByRole('button', { name: 'Retry group' }));
});

it('draws page and section headings at one level each, and panels with their header', () => {
  render(() => <>
    <PageHeader title="Team" description="@team" actions={<Button>Copy</Button>} />
    <Panel label="Group people" title="People" actions={<Badge tone="danger">2</Badge>}><p>body</p></Panel>
    <SectionHeading>Files</SectionHeading>
  </>);
  expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'People' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Files' })).toBeInTheDocument();
  const people = screen.getByRole('region', { name: 'Group people' });
  expect(people.className).toContain('rounded-panel');
  expect(people).toHaveTextContent('body');
});

it('renders a Button with href as a link of the same look, passing anchor props through', () => {
  render(() => <>
    <Button href="/a/doc" variant="secondary" size="sm" target="_blank" rel="noopener" download="doc.html">Open doc</Button>
    <Button href="/a/off" disabled>Unavailable</Button>
    <Button variant="secondary">Plain</Button>
  </>);
  const link = screen.getByRole('link', { name: 'Open doc' });
  expect(link.tagName).toBe('A');
  expect(link).toHaveAttribute('href', '/a/doc');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener');
  expect(link).toHaveAttribute('download', 'doc.html');
  const plain = screen.getByRole('button', { name: 'Plain' });
  for (const token of ['h-control-sm', 'border-edge-bright', 'bg-surface']) expect(link.className).toContain(token);
  expect(plain.className).toContain('border-edge-bright');
  // An anchor cannot be disabled natively: it drops its href and says so.
  const off = screen.getByText('Unavailable');
  expect(off.tagName).toBe('A');
  expect(off).not.toHaveAttribute('href');
  expect(off).toHaveAttribute('aria-disabled', 'true');
});

it('marks a toggle Button pressed with aria-pressed and a distinct look', () => {
  const [on, setOn] = createSignal(false);
  render(() => <Button pressed={on()} onClick={() => setOn(!on())}>Images</Button>);
  const chip = screen.getByRole('button', { name: 'Images' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  expect(chip.className).toContain('border-edge-bright');
  expect(chip.className).not.toContain('bg-accent-soft');
  fireEvent.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(chip.className).toContain('bg-accent-soft');
  expect(chip.className).toContain('text-accent');
});

it('offers an extra-compact xs icon size, a 36px bar size and a caution variant', () => {
  render(() => <>
    <Button size="xs" variant="ghost" icon aria-label="Close comments">×</Button>
    <Button size="bar" variant="ghost" icon aria-label="Notifications">!</Button>
    <Button variant="caution" pressed aria-label="Read and write">rw</Button>
  </>);
  const xs = screen.getByRole('button', { name: 'Close comments' });
  expect(xs.className).toContain('size-control-xs');
  expect(xs.className).toContain('pointer-coarse:min-h-9');
  expect(screen.getByRole('button', { name: 'Notifications' }).className).toContain('size-9');
  const caution = screen.getByRole('button', { name: 'Read and write' });
  expect(caution.className).toContain('bg-caution-soft');
  expect(caution.className).toContain('text-caution');
});

it('names a Checkbox by ariaLabel when it has no visible label', () => {
  const onChange = vi.fn();
  render(() => <Checkbox ariaLabel="Select row Report" checked={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select row Report' }));
  expect(onChange).toHaveBeenCalledWith(true);
});

it('forwards rest attributes to a Panel and a StatusMessage root', () => {
  const onClick = vi.fn();
  render(() => <>
    <Panel label="Tokens" id="tokens" aria-busy="true" data-kind="list" onClick={onClick}><p>rows</p></Panel>
    <StatusMessage kind="caution" aria-label="Write access notice">Anyone with the link can write.</StatusMessage>
  </>);
  const panel = screen.getByRole('region', { name: 'Tokens' });
  expect(panel).toHaveAttribute('id', 'tokens');
  expect(panel).toHaveAttribute('aria-busy', 'true');
  expect(panel).toHaveAttribute('data-kind', 'list');
  fireEvent.click(panel);
  expect(onClick).toHaveBeenCalled();
  const notice = screen.getByRole('status', { name: 'Write access notice' });
  expect(notice.className).toContain('text-caution');
  render(() => <Badge tone="caution">read & write</Badge>);
  expect(screen.getByText('read & write').className).toContain('text-caution');
});

it('gives Tabs icons, distinct names, badges, tooltips, controls and a disabled reason', () => {
  const [value, setValue] = createSignal('selection');
  render(() => <Tabs label="Edit panel tabs" variant="pill" size="sm" value={value()} onChange={setValue} items={[
    { value: 'selection', label: 'Selection', icon: () => <svg data-icon="sliders" />, badge: true, controls: 'panel-body', tooltip: 'Selected block' },
    { value: 'history', label: 'History', ariaLabel: 'Version history', disabled: true, disabledReason: 'History is not available offline' },
    { value: 'comments', label: 'Comments', badge: <span>3</span> },
  ]} />);
  const selection = screen.getByRole('tab', { name: 'Selection' });
  expect(selection.querySelector('[data-icon="sliders"]')).not.toBeNull();
  expect(selection).toHaveAttribute('aria-controls', 'panel-body');
  expect(selection.querySelector('[data-tab-dot]')).not.toBeNull();
  expect(selection.className).toContain('bg-accent-soft');
  const history = screen.getByRole('tab', { name: 'Version history' });
  expect(history).toBeDisabled();
  expect(history).toHaveAccessibleDescription('History is not available offline');
  expect(screen.getByRole('tab', { name: 'Comments' })).toHaveTextContent('3');
});

it('shows only the icon when Tabs are iconOnly, keeping the label as the name', () => {
  render(() => <Tabs label="Strip" iconOnly value="a" onChange={vi.fn()} items={[{ value: 'a', label: 'Selection', icon: () => <svg data-icon="a" /> }]} />);
  const tab = screen.getByRole('tab', { name: 'Selection' });
  expect(tab).not.toHaveTextContent('Selection');
});

it('moves vertical Tabs with ArrowUp and ArrowDown and says it is vertical', () => {
  const [value, setValue] = createSignal('a');
  render(() => <Tabs label="Rail" orientation="vertical" value={value()} onChange={setValue} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} />);
  const list = screen.getByRole('tablist', { name: 'Rail' });
  expect(list).toHaveAttribute('aria-orientation', 'vertical');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowDown' });
  expect(value()).toBe('b');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'B' }), { key: 'ArrowUp' });
  expect(value()).toBe('a');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' });
  expect(value()).toBe('a');
});

it('draws a tri-state Checkbox: indeterminate is mixed until it is set', () => {
  const [state, setState] = createSignal<boolean | 'mixed'>('mixed');
  render(() => <Checkbox ariaLabel="Expose cell 2" checked={state() === true} indeterminate={state() === 'mixed'} onChange={setState} />);
  const box = screen.getByRole('checkbox', { name: 'Expose cell 2' }) as HTMLInputElement;
  expect(box.indeterminate).toBe(true);
  expect(box).toHaveAttribute('aria-checked', 'mixed');
  fireEvent.click(box);
  expect(state()).toBe(true);
  expect(box.indeterminate).toBe(false);
  expect(box).toBeChecked();
});

it('marks the current page link with aria-current (not aria-pressed) and the pressed look', () => {
  render(() => <>
    <Button variant="ghost" size="sm" href="/account" current>Account</Button>
    <Button variant="ghost" size="sm" href="/assets" current={false}>Assets</Button>
  </>);
  const here = screen.getByRole('link', { name: 'Account' });
  expect(here).toHaveAttribute('aria-current', 'page');
  expect(here).not.toHaveAttribute('aria-pressed');
  expect(here.className).toContain('bg-accent-soft');
  const there = screen.getByRole('link', { name: 'Assets' });
  expect(there).not.toHaveAttribute('aria-current');
  expect(there).not.toHaveAttribute('aria-pressed');
  expect(there.className).not.toContain('bg-accent-soft');
});

it('draws a tile Button around auto-height content: no control height or padding, content stretched', () => {
  render(() => <Button shape="tile" pressed aria-label="Design system Nocturne"><span>specimen</span></Button>);
  const tile = screen.getByRole('button', { name: 'Design system Nocturne' });
  expect(tile).toHaveAttribute('aria-pressed', 'true');
  for (const token of ['h-auto', 'p-0', 'flex-col', 'items-stretch', 'rounded-chip', 'bg-accent-soft']) expect(tile.className).toContain(token);
  for (const token of ['h-control', 'whitespace-nowrap', 'items-center']) expect(tile.className.split(/\s+/)).not.toContain(token);
});

it('draws a code-surface Textarea without the field border, radius or minimum height', () => {
  render(() => <><Textarea surface="code" aria-label="Markup source" /><Textarea aria-label="Notes" /></>);
  const code = screen.getByRole('textbox', { name: 'Markup source' }).className.split(/\s+/);
  for (const token of ['border-0', 'rounded-none', 'bg-transparent', 'resize-none']) expect(code).toContain(token);
  for (const token of ['border-edge-bright', 'bg-surface', 'min-h-16', 'min-h-24']) expect(code).not.toContain(token);
  expect(screen.getByRole('textbox', { name: 'Notes' }).className).toContain('border-edge-bright');
});

it('draws a SearchField as a list filter by default: chrome density with the label, lower-cased, as its placeholder', () => {
  render(() => <><SearchField label="Search people" value="" onValue={() => {}} /><Field label="Find"><SearchField size="md" value="" onValue={() => {}} /></Field></>);
  const filter = screen.getByRole('searchbox', { name: 'Search people' });
  expect(filter).toHaveAttribute('placeholder', 'search people');
  for (const token of ['h-control-sm', 'font-mono', 'text-xs']) expect(filter.className.split(/\s+/)).toContain(token);
  const form = screen.getByRole('searchbox', { name: 'Find' });
  expect(form.className.split(/\s+/)).toContain('h-control');
  expect(form).toHaveAttribute('placeholder', 'find');
});

it('packs an icon-only underline strip (its tabs are squares) and spaces a labelled one', () => {
  const items = [{ value: 'a', label: 'Artifact', icon: () => <span>A</span> }, { value: 'b', label: 'Code', icon: () => <span>B</span> }];
  render(() => <><Tabs label="Icons" iconOnly items={items} value="a" onChange={() => {}} /><Tabs label="Labels" items={items} value="a" onChange={() => {}} /></>);
  const icons = screen.getByRole('tablist', { name: 'Icons' }).className.split(/\s+/);
  expect(icons).toContain('gap-1');
  expect(icons).not.toContain('gap-4');
  expect(screen.getByRole('tablist', { name: 'Labels' }).className.split(/\s+/)).toContain('gap-4');
});
