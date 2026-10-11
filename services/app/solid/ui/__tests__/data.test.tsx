/* @jsxImportSource solid-js */
/** The data primitives: Table, the selectable list row, DropZone and the Combobox with its listbox. */
import { expect, it, vi } from 'vitest';
import { createSignal, For } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../Table';
import { SelectableItem, SelectableList } from '../SelectableList';
import { DropZone } from '../DropZone';
import { Combobox, ComboboxList, createListNavigation } from '../Combobox';
import { Field } from '../Field';
import { renderHook } from '@/solid/__tests__/helpers';

it('draws a named table with column headers, divided hoverable rows and density-sized cells', () => {
  render(() => <Table label="Connections" density="sm">
    <TableHead><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell align="right">Actions</TableHeaderCell></TableHead>
    <TableBody>
      <TableRow aria-label="Token row ci"><TableCell>ci</TableCell><TableCell align="right">revoke</TableCell></TableRow>
      <TableRow interactive={false}><TableCell colSpan={2}>No more tokens.</TableCell></TableRow>
    </TableBody>
  </Table>);
  const table = screen.getByRole('table', { name: 'Connections' });
  expect(table.parentElement!.className).toContain('overflow-x-auto');
  expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Actions']);
  expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('scope', 'col');
  const row = screen.getByRole('row', { name: 'Token row ci' });
  expect(row.className).toContain('border-t');
  expect(row.className).toContain('hover:bg-raised');
  expect(screen.getByText('No more tokens.').closest('tr')!.className).not.toContain('hover:bg-raised');
  expect(screen.getByText('No more tokens.')).toHaveAttribute('colspan', '2');
  expect(screen.getByRole('cell', { name: 'ci' }).className).toContain('px-3');
  expect(screen.getByRole('cell', { name: 'revoke' }).className).toContain('text-right');
});

it('draws selectable rows as full-width buttons or links with a selected state and content beside them', () => {
  const [picked, setPicked] = createSignal(3);
  const onRestore = vi.fn();
  render(() => <SelectableList label="Versions">
    <For each={[3, 2]}>{(version) => <SelectableItem label={`Preview version ${version}`} selected={picked() === version} onSelect={() => setPicked(version)}
      title={`v${version}`} meta="2 days ago">{picked() === version ? <button onClick={onRestore}>Restore v{version}</button> : null}</SelectableItem>}</For>
    <SelectableItem label="Agent session lab" href="/chat?session=lab" title="lab" meta="online" />
  </SelectableList>);
  expect(screen.getByRole('list', { name: 'Versions' })).toBeInTheDocument();
  const v3 = screen.getByRole('button', { name: 'Preview version 3' });
  const v2 = screen.getByRole('button', { name: 'Preview version 2' });
  expect(v3).toHaveAttribute('aria-pressed', 'true');
  expect(v3.className).toContain('bg-accent-soft');
  expect(v2).toHaveAttribute('aria-pressed', 'false');
  expect(v2).toHaveTextContent('v2');
  expect(v2).toHaveTextContent('2 days ago');
  fireEvent.click(v2);
  expect(picked()).toBe(2);
  // The selected row's extra content sits beside the button, never inside it.
  const restore = screen.getByRole('button', { name: 'Restore v2' });
  expect(v2.contains(restore)).toBe(false);
  fireEvent.click(restore);
  expect(picked()).toBe(2);
  expect(onRestore).toHaveBeenCalled();
  const link = screen.getByRole('link', { name: 'Agent session lab' });
  expect(link).toHaveAttribute('href', '/chat?session=lab');
});

it('takes a drop, a click to browse and the keyboard on a DropZone', () => {
  const onFiles = vi.fn();
  render(() => <DropZone label="Choose a file" title="Drop a file here, or click to choose one" hint="Images and pdf" accept=".png,.pdf" onFiles={onFiles} />);
  const zone = screen.getByRole('button', { name: 'Choose a file' });
  expect(zone).toHaveAccessibleDescription('Images and pdf');
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input).toHaveAttribute('accept', '.png,.pdf');
  expect(input).toHaveAttribute('tabindex', '-1');
  const click = vi.spyOn(input, 'click').mockImplementation(() => {});
  fireEvent.click(zone);
  expect(click).toHaveBeenCalledTimes(1);
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
  expect(zone).toHaveAttribute('data-dragging', 'true');
  expect(zone.className).toContain('border-dashed');
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(zone).not.toHaveAttribute('data-dragging');
  expect(onFiles).toHaveBeenCalledWith([file]);
  fireEvent.change(input, { target: { files: [file] } });
  expect(onFiles).toHaveBeenCalledTimes(2);
});

it('ignores a disabled DropZone', () => {
  const onFiles = vi.fn();
  render(() => <DropZone label="Choose a file" title="Drop" disabled onFiles={onFiles} />);
  const zone = screen.getByRole('button', { name: 'Choose a file' });
  expect(zone).toBeDisabled();
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.png')] } });
  expect(onFiles).not.toHaveBeenCalled();
});

const PEOPLE = [{ id: 'u1', username: 'ada' }, { id: 'u2', username: 'bob' }, { id: 'u3', username: 'cy' }];

it('suggests options under a combobox input, walking them with arrows and picking with Enter', () => {
  const [query, setQuery] = createSignal('');
  const onSelect = vi.fn();
  render(() => <Field label="Add people"><Combobox value={query()} onValue={setQuery} options={PEOPLE} optionKey={(p) => p.id}
    renderOption={(p) => <>@{p.username}</>} onSelect={onSelect} listLabel="People suggestions" placeholder="@username" /></Field>);
  const input = screen.getByRole('combobox', { name: 'Add people' });
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveAttribute('aria-autocomplete', 'list');
  fireEvent.input(input, { target: { value: 'a' } });
  expect(query()).toBe('a');
  expect(input).toHaveAttribute('aria-expanded', 'true');
  const list = screen.getByRole('listbox', { name: 'People suggestions' });
  expect(input).toHaveAttribute('aria-controls', list.id);
  expect(input).not.toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const ada = screen.getByRole('option', { name: '@ada' });
  expect(input).toHaveAttribute('aria-activedescendant', ada.id);
  expect(ada).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: '@cy' }).id);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith(PEOPLE[2]);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('closes the combobox on Escape without leaving an enclosing dialog, and picks by click', () => {
  const onSelect = vi.fn();
  const outer = vi.fn();
  render(() => <div onKeyDown={(event) => { if (!event.defaultPrevented) outer(); }}>
    <Combobox ariaLabel="Find people" value="" onValue={vi.fn()} options={PEOPLE} optionKey={(p) => p.id} renderOption={(p) => <>@{p.username}</>} onSelect={onSelect} status={PEOPLE.length ? undefined : 'No people found.'} />
  </div>);
  const input = screen.getByRole('combobox', { name: 'Find people' });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: '@bob' }));
  expect(onSelect).toHaveBeenCalledWith(PEOPLE[1]);
});

it('shows a status line in the open list when there is nothing to pick', () => {
  render(() => <Combobox ariaLabel="Find people" value="zz" onValue={vi.fn()} options={[] as typeof PEOPLE} optionKey={(p) => p.id} renderOption={(p) => <>@{p.username}</>} onSelect={vi.fn()} status="No people found." />);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
  expect(screen.getByRole('status')).toHaveTextContent('No people found.');
});

it('lets a textarea-driven picker reuse the listbox and its keyboard', () => {
  const onSelect = vi.fn();
  const { result: nav } = renderHook(() => createListNavigation({ count: () => PEOPLE.length, onSelect: (i) => onSelect(PEOPLE[i]) }));
  render(() => <ComboboxList id="mentions" label="Mention suggestions" options={PEOPLE} optionKey={(p) => p.id} renderOption={(p) => <>@{p.username}</>} active={nav.active()} onActive={nav.setActive} onSelect={onSelect} />);
  expect(nav.keyDown('ArrowDown')).toBe(true);
  expect(screen.getByRole('option', { name: '@ada' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: '@ada' }).id).toBe(`mentions-${0}`);
  expect(nav.keyDown('ArrowUp')).toBe(true);
  expect(screen.getByRole('option', { name: '@cy' })).toHaveAttribute('aria-selected', 'true');
  expect(nav.keyDown('Enter')).toBe(true);
  expect(onSelect).toHaveBeenCalledWith(PEOPLE[2]);
  expect(nav.keyDown('x')).toBe(false);
  fireEvent.mouseEnter(screen.getByRole('option', { name: '@bob' }));
  expect(nav.active()).toBe(1);
});
