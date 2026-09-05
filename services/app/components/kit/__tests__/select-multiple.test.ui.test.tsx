import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Select, SelectControl } from '../controls';
describe('multi-select editor contract', () => {
  it('keeps a draft until Done and commits an unambiguous JSON selection', () => {
    const onChange = vi.fn();
    render(<SelectControl label="Tags" multiple valueFormat="json" allowCreate value={'["missing"]'} options={[{value:'design,ux', label:'Design, UX'}]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.click(screen.getByRole('option', {name: /Design, UX/}));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Done'}));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual(['missing','design,ux']);
  });

  it('keeps single-select selection immediate and closes the menu', () => {
    const onChange = vi.fn();
    render(<SelectControl label="Status" value="todo" options={[{value:'todo', label:'To do'}, {value:'done', label:'Done'}]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Status'));
    fireEvent.click(screen.getByRole('option', {name:'Done'}));
    expect(onChange).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('creates comma, quote, and unicode values and deduplicates them', () => {
    const onChange = vi.fn();
    render(<SelectControl label="Tags" multiple valueFormat="json" allowCreate value="[]" options={[]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    const search = screen.getByRole('searchbox');
    for (const value of ['a,b', 'say "hi"', '雪']) {
      fireEvent.change(search, {target:{value}});
      fireEvent.click(screen.getByRole('option', {name:new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}));
    }
    fireEvent.change(search, {target:{value:'a,b'}});
    fireEvent.keyDown(search, {key:'Home'});
    // Existing selected values remain unique; selecting them again removes them.
    expect(screen.queryByLabelText('Create a,b')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name:'Done'}));
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual(['a,b', 'say "hi"', '雪']);
  });

  it('preserves missing values, commits outside once, and cancels with Escape', () => {
    const onChange = vi.fn();
    render(<><SelectControl label="Tags" multiple valueFormat="json" value={'["missing"]'} options={[{value:'known',label:'Known'}]} onChange={onChange} /><button>Outside</button></>);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.click(screen.getByRole('option', {name:'Known'}));
    fireEvent.mouseDown(screen.getByRole('button', {name:'Outside'}));
    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual(['missing','known']);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.click(screen.getByRole('option', {name:'Known'}));
    fireEvent.keyDown(screen.getByRole('searchbox'), {key:'Escape'});
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports open, commit, and cancel lifecycle events', () => {
    const onOpenChange = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<SelectControl label="Tags" multiple valueFormat="json" value="[]" options={[{value:'x',label:'X'}]} onChange={() => {}} onOpenChange={onOpenChange} onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.click(screen.getByRole('option', {name:'X'}));
    fireEvent.click(screen.getByRole('button', {name:'Done'}));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(onCommit).toHaveBeenCalledWith('["x"]');
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.keyDown(screen.getByRole('searchbox'), {key:'Escape'});
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a deterministic disabled static face with selected labels', () => {
    const html = renderToString(<Select label="Tags" multiple valueFormat="json" value={'["a","missing"]'} options={[{value:'a',label:'Alpha'}]} />);
    expect(html).toContain('Alpha, missing');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="listbox"');
  });

  it('portals the popup into the trigger ownerDocument', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const mount = doc.createElement('div');
    doc.body.append(mount);
    const root = createRoot(mount);
    await act(async () => root.render(<SelectControl label="Frame tags" multiple valueFormat="json" value="[]" options={[{value:'x',label:'X'}]} onChange={() => {}} />));
    const trigger = within(doc.body).getByLabelText('Frame tags');
    fireEvent.click(trigger);
    expect(within(doc.body).getByRole('listbox').ownerDocument).toBe(doc);
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => root.unmount());
    frame.remove();
  });
});

describe('rich Select resilience', () => {
  it('blocks malformed JSON without silently replacing it', () => {
    render(<SelectControl label="Broken" multiple valueFormat="json" value='[1,"a"]' options={[]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Broken')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('JSON array of strings');
  });
  it('allows removing missing options', () => {
    const change = vi.fn();
    render(<SelectControl label="Tags" multiple value={'["missing"]'} options={[]} onChange={change} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.click(screen.getByLabelText('missing'));
    fireEvent.click(screen.getByLabelText('Done'));
    expect(change).toHaveBeenCalledWith('[]');
  });
  it('preserves the supplied draft on reopening after virtualization', () => {
    const draft = vi.fn(); const change = vi.fn();
    render(<SelectControl label="Tags" multiple value='[]' draftValue='["kept"]' onDraftChange={draft} options={[]} onChange={change} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    expect(draft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Done'));
    expect(change).toHaveBeenCalledWith('["kept"]');
  });
  it('offers creation even when existing labels partially match', () => {
    render(<SelectControl label="Tags" multiple allowCreate value='[]' options={[{value:'foobar',label:'Foobar'}]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    fireEvent.change(screen.getByLabelText('Search Tags'), {target:{value:'foo'}});
    expect(screen.getByLabelText('Create foo')).toBeInTheDocument();
  });
  it('cancels Escape from any popup element and restores trigger focus', () => {
    const cancel = vi.fn();
    render(<SelectControl label="Tags" multiple value='[]' options={[]} onChange={vi.fn()} onCancel={cancel} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    screen.getByLabelText('Done').focus();
    fireEvent.keyDown(screen.getByLabelText('Done'), {key:'Escape'});
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Tags')).toHaveFocus();
  });
  it('disables an already open editor while pending', () => {
    const change = vi.fn();
    const {rerender} = render(<SelectControl label="Tags" multiple value='[]' options={[]} onChange={change} />);
    fireEvent.click(screen.getByLabelText('Tags'));
    rerender(<SelectControl label="Tags" multiple value='[]' options={[]} onChange={change} disabled />);
    expect(screen.queryByLabelText('Done')).toBeNull();
    fireEvent.mouseDown(document.body);
    expect(change).not.toHaveBeenCalled();
    rerender(<SelectControl label="Tags" multiple value='[]' options={[]} onChange={change} />);
    expect(screen.queryByLabelText('Done')).toBeNull();
  });
  it('copies theme identity without ancestor layout classes and tracks viewport position', () => {
    render(<div data-theme="nocturne" className="dark p-20 container"><SelectControl label="Tags" multiple value='[]' options={[]} onChange={vi.fn()} /></div>);
    const trigger = screen.getByLabelText('Tags');
    const root = trigger.parentElement!;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({left:1000,bottom:760,width:200,top:724} as DOMRect);
    fireEvent.click(trigger);
    const popup = screen.getByLabelText('Search Tags').parentElement!.parentElement!;
    expect(popup.style.position).toBe('fixed'); // authored CSS filtering must not control runtime portal layout
    expect(popup).toHaveAttribute('data-theme','nocturne');
    expect(popup).not.toHaveClass('p-20','container');
    expect(parseFloat(popup.style.left)).toBeLessThan(1000);
    vi.mocked(root.getBoundingClientRect).mockReturnValue({left:25,bottom:70,width:200,top:34} as DOMRect);
    fireEvent.scroll(document);
    expect(popup.style.left).toBe('25px');
  });
});

it('renders a compact cell without repeating its accessible label above the trigger', () => {
  const {container} = render(<SelectControl appearance="cell" label="Status 1" value="active" options={[{value:'active',label:'Active'}]} onChange={vi.fn()} />);
  expect(screen.getByLabelText('Status 1')).toHaveTextContent('Active');
  expect(container.querySelector('.mx-control > span')).toBeNull();
});

it('keeps reference-creation actions separate from values and cancels without writing', () => {
  const change = vi.fn(), cancel = vi.fn(), add = vi.fn();
  render(<SelectControl label="Sprint" value="one" options={[{value:'one',label:'One'}]} onChange={change} onCancel={cancel}><button aria-label="Add Sprint" onClick={add}>Add Sprint…</button></SelectControl>);
  fireEvent.click(screen.getByLabelText('Sprint'));
  const action = screen.getByLabelText('Add Sprint');
  expect(action.closest('[role="listbox"]')).toBeNull();
  fireEvent.click(action);
  expect(add).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Search Sprint')).toBeNull();
});

it('commits when keyboard focus leaves the popup', () => {
  const change = vi.fn();
  render(<><SelectControl label="Tags" multiple value='[]' options={[]} onChange={change}/><button aria-label="Outside">Outside</button></>);
  fireEvent.click(screen.getByLabelText('Tags'));
  fireEvent.blur(screen.getByLabelText('Search Tags'), {relatedTarget:screen.getByLabelText('Outside')});
  expect(change).toHaveBeenCalledWith('[]');
  expect(screen.queryByLabelText('Done')).toBeNull();
});
it('reaches the create option with the keyboard after partial matches', () => {
  const change = vi.fn();
  render(<SelectControl label="Tags" multiple allowCreate value='[]' options={[{value:'foobar',label:'Foobar'}]} onChange={change}/>);
  fireEvent.click(screen.getByLabelText('Tags'));
  const search = screen.getByLabelText('Search Tags');
  fireEvent.change(search,{target:{value:'foo'}});
  fireEvent.keyDown(search,{key:'ArrowDown'});
  fireEvent.keyDown(search,{key:'Enter'});
  fireEvent.click(screen.getByLabelText('Done'));
  expect(change).toHaveBeenCalledWith('["foo"]');
});
