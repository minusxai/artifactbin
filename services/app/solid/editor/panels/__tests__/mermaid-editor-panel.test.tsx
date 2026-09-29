/* @jsxImportSource solid-js */
/**
 * components/__tests__/mermaid-editor-panel.ui.test.tsx, PORTED to the Solid panel.
 * Same assertions; `act()` has no Solid counterpart since updates are synchronous.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import MermaidEditorPanel, { type MermaidEditorPanelProps } from '../MermaidEditorPanel';

const embed = { code: 'flowchart TD; A-->B', title: 'Flow' };

describe('MermaidEditorPanel', () => {
  it('commits an edited source on blur and again on ⌘⏎', () => {
    const onChange = vi.fn();
    render(() => <MermaidEditorPanel embed={embed} onChange={onChange} />);
    const source = screen.getByLabelText('Diagram source');
    fireEvent.input(source, { target: { value: 'flowchart LR; A-->B' } });
    fireEvent.blur(source);
    expect(onChange).toHaveBeenCalledWith({ code: 'flowchart LR; A-->B' });
    fireEvent.input(source, { target: { value: 'flowchart LR; A-->C' } });
    fireEvent.keyDown(source, { key: 'Enter', metaKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ code: 'flowchart LR; A-->C' });
  });
  it('emits nothing for an unchanged source', () => {
    const onChange = vi.fn();
    render(() => <MermaidEditorPanel embed={embed} onChange={onChange} />);
    fireEvent.blur(screen.getByLabelText('Diagram source'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('names a refused source instead of writing it', () => {
    const onChange = vi.fn();
    render(() => <MermaidEditorPanel embed={embed} onChange={onChange} />);
    const source = screen.getByLabelText('Diagram source');
    fireEvent.input(source, { target: { value: '%%{init: {"theme":"dark"}}%%\nflowchart TD; A-->B' } });
    fireEvent.blur(source);
    expect(screen.getByLabelText('Diagram source error')).toHaveTextContent('configuration directives');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('commits the title on blur, empty as null', () => {
    const onChange = vi.fn();
    render(() => <MermaidEditorPanel embed={embed} onChange={onChange} />);
    const title = screen.getByLabelText('Diagram title');
    fireEvent.input(title, { target: { value: 'Order pipeline' } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenCalledWith({ title: 'Order pipeline' });
    fireEvent.input(title, { target: { value: '' } });
    fireEvent.blur(title);
    expect(onChange).toHaveBeenLastCalledWith({ title: null });
  });
  it('reseeds the draft when the embed changes from outside, discarding an unblurred edit', () => {
    const onChange = vi.fn();
    const next = { code: 'flowchart TD; A-->B-->C', title: 'Flow' };
    function Harness(props: { embed: MermaidEditorPanelProps['embed'] }) {
      return <MermaidEditorPanel embed={props.embed} onChange={onChange} />;
    }
    const [current, setCurrent] = createSignal(embed);
    render(() => <Harness embed={current()} />);
    const source = screen.getByLabelText('Diagram source') as HTMLTextAreaElement;
    fireEvent.input(source, { target: { value: 'flowchart LR; A-->Z (never committed)' } });
    setCurrent(next);
    expect(screen.getByLabelText('Diagram source')).toHaveValue(next.code);
  });
});
