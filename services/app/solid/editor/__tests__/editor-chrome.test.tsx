/* @jsxImportSource solid-js */
/** The editor's view switch is ui/Tabs: names, roving focus, arrow keys, tooltips, icon-only on a phone. */
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { EditorViewTabs } from '../EditorChrome';

afterEach(() => { Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true }); });

function Harness(props: { disabledSource?: boolean }) {
  const [view, setView] = createSignal('design');
  const choose = vi.fn();
  const tabs = () => [
    { key: 'design', label: 'Artifact', aria: 'Edit on the page', tip: 'edit on the page', icon: <i data-testid="design-icon" />, active: view() === 'design', choose: () => { choose('design'); setView('design'); } },
    { key: 'code', label: 'Code', aria: 'Edit the source', tip: 'edit the source', icon: <i />, active: view() === 'code', disabled: props.disabledSource, choose: () => { choose('code'); setView('code'); } },
    { key: 'data', label: 'Data', aria: 'Show data', tip: "the document's queries", icon: <i />, active: view() === 'data', choose: () => { choose('data'); setView('data'); } },
  ];
  return <><EditorViewTabs tabs={tabs()} /><output data-testid="chosen" data-view={view()} data-calls={choose.mock.calls.length} /></>;
}

it('is a tablist of named tabs; the active one is the only tab stop and its label is visible', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
  render(() => <Harness />);
  expect(screen.getByRole('tablist', { name: 'Editor view' })).toBeInTheDocument();
  const design = screen.getByRole('tab', { name: 'Edit on the page' });
  expect(design).toHaveAttribute('aria-selected', 'true');
  expect(design).toHaveAttribute('tabindex', '0');
  expect(design.textContent).toContain('Artifact');
  expect(screen.getByTestId('design-icon')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Edit the source' })).toHaveAttribute('tabindex', '-1');
});

it('moves with the arrow keys, Home and End, keeping focus on the tab it chose', () => {
  render(() => <Harness />);
  const design = screen.getByRole('tab', { name: 'Edit on the page' });
  design.focus();
  fireEvent.keyDown(design, { key: 'ArrowRight' });
  const code = screen.getByRole('tab', { name: 'Edit the source' });
  expect(code).toHaveAttribute('aria-selected', 'true');
  expect(document.activeElement).toBe(code);
  fireEvent.keyDown(code, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Show data' })).toHaveAttribute('aria-selected', 'true');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Show data' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Edit on the page' })).toHaveAttribute('aria-selected', 'true');
});

it('skips a disabled tab and does not choose it on click', () => {
  render(() => <Harness disabledSource />);
  const code = screen.getByRole('tab', { name: 'Edit the source' });
  expect(code).toBeDisabled();
  fireEvent.click(code);
  expect(screen.getByTestId('chosen')).toHaveAttribute('data-view', 'design');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Edit on the page' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Show data' })).toHaveAttribute('aria-selected', 'true');
});

it('cancels the mouse-down default so a press never takes focus from the document', () => {
  render(() => <Harness />);
  expect(fireEvent.mouseDown(screen.getByRole('tab', { name: 'Edit the source' }))).toBe(false);
});

it('drops the labels on a phone, leaving the aria name', () => {
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true, writable: true });
  render(() => <Harness />);
  const design = screen.getByRole('tab', { name: 'Edit on the page' });
  expect(design.textContent).not.toContain('Artifact');
  expect(screen.getByTestId('design-icon')).toBeInTheDocument();
});
