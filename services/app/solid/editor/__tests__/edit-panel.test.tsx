/* @jsxImportSource solid-js */
/**
 * components/EditPanel.tsx port: same frame contract — tabs, the dot, collapse — ported from
 * components/__tests__/backend-unavailable.ui.test.tsx's EditPanel cases (adapted: this Solid panel
 * takes `historyUnavailable` as a prop instead of reading it from a backend context — see the
 * DEVIATION note in EditPanel.tsx) plus the frame's own basic tab/collapse behavior.
 */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import EditPanel, { type EditPanelTab } from '../EditPanel';

const OFFLINE = 'Not available in a downloaded file.';

function Harness(props: { collapsed?: boolean; historyUnavailable?: string | null }) {
  const [tab, setTab] = createSignal<EditPanelTab>('selection');
  const [collapsed, setCollapsed] = createSignal(props.collapsed ?? false);
  return (
    <EditPanel
      top={0}
      tab={tab()}
      onTab={setTab}
      collapsed={collapsed()}
      onCollapsedChange={setCollapsed}
      selectionDot={false}
      commentsAvailable
      historyUnavailable={props.historyUnavailable ?? null}
    >
      <p>body</p>
    </EditPanel>
  );
}

it('shows Selection, History and Comments tabs, and switches the active one', () => {
  render(() => <Harness />);
  expect(screen.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'History' }));
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'false');
});

it('hides the Comments tab when comments are unavailable', () => {
  function NoComments() {
    const [tab, setTab] = createSignal<EditPanelTab>('selection');
    return (
      <EditPanel top={0} tab={tab()} onTab={setTab} collapsed={false} onCollapsedChange={vi.fn()} selectionDot={false} commentsAvailable={false}>
        <p>body</p>
      </EditPanel>
    );
  }
  render(() => <NoComments />);
  expect(screen.queryByRole('tab', { name: 'Comments' })).toBeNull();
});

it('collapses to an icon strip and expands back', () => {
  render(() => <Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
  expect(screen.getByRole('button', { name: 'Expand panel' })).toBeTruthy();
  expect(screen.queryByRole('tabpanel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
  expect(screen.getByRole('tabpanel')).toBeTruthy();
});

it('disables the History tab with the reason when history is unavailable, expanded and collapsed', () => {
  render(() => <Harness historyUnavailable={OFFLINE} />);
  const history = screen.getByRole('tab', { name: 'History' });
  expect(history).toBeDisabled();
  expect(history).toHaveAccessibleDescription(OFFLINE);
  expect(screen.getByRole('tab', { name: 'Selection' })).toBeEnabled();

  render(() => <Harness historyUnavailable={OFFLINE} collapsed />);
  const collapsedHistory = screen.getAllByRole('tab', { name: 'History' }).at(-1)!;
  expect(collapsedHistory).toBeDisabled();
  expect(collapsedHistory).toHaveAccessibleDescription(OFFLINE);
});

it('offers the History tab online, with no description', () => {
  const onTab = vi.fn();
  function Online() {
    const [tab, setTab] = createSignal<EditPanelTab>('selection');
    return (
      <EditPanel top={0} tab={tab()} onTab={(t) => { setTab(t); onTab(t); }} collapsed={false} onCollapsedChange={vi.fn()} selectionDot={false} commentsAvailable historyUnavailable={null}>
        <p>body</p>
      </EditPanel>
    );
  }
  render(() => <Online />);
  const history = screen.getByRole('tab', { name: 'History' });
  expect(history).toBeEnabled();
  expect(history).not.toHaveAccessibleDescription();
  fireEvent.click(history);
  expect(onTab).toHaveBeenCalledWith('history');
});

it('shows a dot on the Selection tab when a new selection exists behind another tab', () => {
  function Dotted() {
    const [tab, setTab] = createSignal<EditPanelTab>('history');
    return (
      <EditPanel top={0} tab={tab()} onTab={setTab} collapsed={false} onCollapsedChange={vi.fn()} selectionDot commentsAvailable>
        <p>body</p>
      </EditPanel>
    );
  }
  render(() => <Dotted />);
  expect(screen.getByRole('tab', { name: 'Selection' }).querySelector('[aria-hidden="true"]')).toBeTruthy();
});
