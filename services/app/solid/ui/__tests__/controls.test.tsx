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
