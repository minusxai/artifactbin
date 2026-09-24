import {expect, it, vi, beforeEach} from 'vitest';
import {render, fireEvent, screen, waitFor} from '@testing-library/react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseFragment, type DefaultTreeAdapterMap} from 'parse5';
import {Dialog, DialogTrigger, DialogContent, DialogClose, ArtifactDialogScope} from '@/components/kit/dialog';
import {Button} from '@/components/kit/button';
import {renderStoryNodes} from '@/lib/story-ui/interpreter';
import {STORY_UI_COMPONENTS} from '@/lib/story-ui/registry';
import {parseJsxOrThrow} from '@/test/helpers/jsx';
import {validateJsxSource} from '@/lib/jsx';
import {JSX_STORY_COMPONENT_NAMES} from '@/lib/jsx/components';
import {STORY_HTML_TAGS} from '@/lib/story-ui/component-names';

beforeEach(() => {
  HTMLDialogElement.prototype.show = function () {this.open = true;};
  HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new Event('close'));};
});

it('opens, cancels, and returns focus to the trigger', async () => {
  render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor"><input aria-label="Name" autoFocus /><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
  const trigger = screen.getByText('Open');
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', {name: 'Editor'})).toBeVisible();
  fireEvent.click(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

/**
 * An artifact dialog opens with the non-modal `show()` and traps focus itself,
 * so the modality a screen reader announces has to be said out loud.
 */
it('announces itself as a modal dialog under the author\'s label, in both scopes', () => {
  for (const scoped of [false, true]) {
    const tree = <Dialog defaultOpen><DialogContent aria-label="Editor"><p>Body</p></DialogContent></Dialog>;
    const view = render(scoped ? <ArtifactDialogScope>{tree}</ArtifactDialogScope> : tree);
    expect(screen.getByRole('dialog', {name: 'Editor'})).toHaveAttribute('aria-modal', 'true');
    view.unmount();
  }
});

/**
 * The documented example is a field, a submit and a Close written as siblings;
 * in a block box they ran together on one line. An unstyled panel stacks them
 * — `open:` keeps the UA's `display:none` on a closed dialog — and the form and
 * fieldset step aside so their children are the ones stacked. A panel the
 * author styled keeps exactly the flow it had.
 */
it('stacks the children of an unstyled panel, and leaves a styled one alone', () => {
  const view = render(<Dialog defaultOpen><DialogContent aria-label="Plain" onSubmitMutation={async () => {}}><input aria-label="Name" /><button type="submit">Save</button></DialogContent></Dialog>);
  const plain = screen.getByRole('dialog', {name: 'Plain'});
  expect(plain.className.split(' ')).toEqual(expect.arrayContaining(['open:flex', 'flex-col', 'gap-4']));
  expect(plain.querySelector('form')).toHaveClass('contents');
  view.unmount();
  render(<Dialog defaultOpen><DialogContent aria-label="Styled" className="p-0" onSubmitMutation={async () => {}}><input aria-label="Name" /></DialogContent></Dialog>);
  const styled = screen.getByRole('dialog', {name: 'Styled'});
  expect(styled).not.toHaveClass('open:flex');
  expect(styled).not.toHaveClass('gap-4');
  expect(styled.querySelector('form')).not.toHaveClass('contents');
});

/** The delegating trigger owns no focusable box of its own, so closing has to find the author's control. */
it('returns focus to the Button inside a delegating trigger, not to the span around it', async () => {
  render(<Dialog><DialogTrigger wrapsControl><Button>Add task</Button></DialogTrigger><DialogContent aria-label="Add"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
  const button = screen.getByText('Add task');
  expect(button.tagName).toBe('BUTTON');
  fireEvent.click(button);
  expect(screen.getByRole('dialog', {name: 'Add'})).toBeVisible();
  fireEvent.click(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(button).toHaveFocus();
});

it('keeps a pending submission open, shows rejection, and closes only after success', async () => {
  let reject!: (error: Error) => void;
  const submit = vi.fn(() => new Promise<void>((_resolve, no) => {reject = no;}));
  render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor" onSubmitMutation={submit}><input aria-label="Name" required /><button type="submit">Save</button><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
  fireEvent.click(screen.getByText('Open'));
  const dialog = screen.getByRole('dialog');
  const form = dialog.querySelector('form')!;
  fireEvent.submit(form);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Test'}});
  fireEvent.submit(form);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  fireEvent(dialog, new Event('cancel', {cancelable: true}));
  expect(dialog).toHaveAttribute('open');
  reject(new Error('Write refused'));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Write refused');
  expect(dialog).toHaveAttribute('open');
  submit.mockImplementation(async () => {});
  fireEvent.submit(form);
  await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
});

it('returns focus to the trigger after a successful submission', async () => {
  document.body.tabIndex = -1;
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
    queueMicrotask(() => document.body.focus());
  };
  render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor" onSubmitMutation={async () => {}}><button type="submit">Save</button></DialogContent></Dialog>);
  const trigger = screen.getByText('Open');
  fireEvent.click(trigger);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
});


it('keeps artifact dialogs out of the global modal layer, with keyboard and backdrop dismissal', async () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, 'show').mockImplementation(function(this: HTMLDialogElement) {this.open = true;});
  const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
  try {
    const view = render(<ArtifactDialogScope><Dialog><DialogTrigger>Open scoped</DialogTrigger><DialogContent aria-label="Scoped"><input aria-label="First" /><DialogClose>Last</DialogClose></DialogContent></Dialog></ArtifactDialogScope>);
    fireEvent.click(screen.getByText('Open scoped'));
    expect(show).toHaveBeenCalledOnce();
    expect(modal).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {name:'Scoped'});
    screen.getByText('Last').focus();
    fireEvent.keyDown(dialog, {key:'Tab'});
    expect(screen.getByLabelText('First')).toHaveFocus();
    fireEvent.keyDown(dialog, {key:'Escape'});
    await waitFor(() => expect(screen.queryByRole('dialog', {name:'Scoped'})).toBeNull());
    fireEvent.click(screen.getByText('Open scoped'));
    fireEvent.click(view.container.querySelector('[data-artifact-dialog-backdrop]')!);
    await waitFor(() => expect(screen.queryByRole('dialog', {name:'Scoped'})).toBeNull());
    expect(screen.getByText('Open scoped')).toHaveFocus();
  } finally {show.mockRestore(); modal.mockRestore();}
});


it('preserves the field focus chosen by native show for an artifact dialog', () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, 'show').mockImplementation(function(this: HTMLDialogElement) {
    this.open = true;
    this.querySelector<HTMLInputElement>('input')?.focus();
  });
  try {
    render(<ArtifactDialogScope><Dialog><DialogTrigger>Open focused</DialogTrigger><DialogContent aria-label="Focused"><input aria-label="Draft" autoFocus /><DialogClose>Close focused</DialogClose></DialogContent></Dialog></ArtifactDialogScope>);
    fireEvent.click(screen.getByText('Open focused'));
    expect(screen.getByLabelText('Draft')).not.toHaveAttribute('autofocus');
    expect(screen.getByLabelText('Draft')).toHaveFocus();
  } finally {show.mockRestore();}
});

/**
 * A `<button>` may not contain another one. The author's reflex —
 * `<DialogTrigger><Button>Add task</Button></DialogTrigger>` — put the kit's
 * styled button inside the trigger's own, and the HTML parser does not keep it
 * there: it closes the outer button and PROMOTES the inner one to its sibling.
 * The browser's DOM then differs from React's tree and hydration dies with
 * error 418 (the served
 * `<button id="Nhvn"><button id="kUDI">Add task</button></button>` parsed as an
 * empty trigger followed by the real button). parse5 runs the same parsing
 * algorithm as the browser, so this pins the shape without one.
 */
it('a Button inside a DialogTrigger survives HTML parsing where React put it — the trigger draws no button of its own', () => {
  const source = '<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger><DialogContent aria-label="Add"><DialogClose id="cancel"><Button id="cancelled">Cancel</Button></DialogClose></DialogContent></Dialog>';
  // Publish accepts this shape (scripts/gate-hydration publishes it), so the renderer is what has to hold it together.
  expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style')).toEqual([]);
  const parsed = parseJsxOrThrow(source);
  const html = renderToStaticMarkup(<>{renderStoryNodes(parsed.nodes, {components: STORY_UI_COMPONENTS})}</>);
  const doc = parseFragment(html);
  const find = (node: DefaultTreeAdapterMap['node'], id: string): DefaultTreeAdapterMap['element'] | null => {
    if ('attrs' in node && node.attrs.some(a => a.name === 'id' && a.value === id)) return node;
    for (const child of 'childNodes' in node ? node.childNodes : []) {
      const hit = find(child, id);
      if (hit) return hit;
    }
    return null;
  };
  for (const [outer, inner] of [['trigger', 'add'], ['cancel', 'cancelled']]) {
    const wrapper = find(doc, outer)!;
    expect(wrapper.nodeName).not.toBe('button'); // a button around a button is what the parser tears apart
    expect(find(wrapper, inner)).not.toBeNull(); // still inside it after parsing, where React's tree says it is
  }
  expect(html).toContain('Add task');
});
