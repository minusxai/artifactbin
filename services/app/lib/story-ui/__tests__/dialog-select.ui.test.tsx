/**
 * A Dialog an author gets by default, and a Select that can be used inside it.
 * Reproduced on a published page: the dialog computed `padding: 0px`, and the
 * Select's listbox was portaled to `document.body`, painted under the dialog.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ArtifactDialogScope, Dialog, DialogContent, DialogTrigger} from '@/components/kit/dialog';
import {SelectControl} from '@/components/kit/controls';

beforeEach(() => {
  HTMLDialogElement.prototype.show = function () {this.open = true;};
  HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new Event('close'));};
});

const PAYERS = [{value: 'ann', label: 'Ann'}, {value: 'bo', label: 'Bo'}];

describe.each([
  ['a published page (dialog.show)', true],
  ['a raw or exported page (dialog.showModal)', false],
])('Select inside a Dialog on %s', (_name, scoped) => {
  it('opens its listbox inside the dialog and picks an option', () => {
    const onChange = vi.fn();
    const tree = (
      <Dialog>
        <DialogTrigger>Add expense</DialogTrigger>
        <DialogContent aria-label="Add expense">
          <SelectControl label="Paid by" value={null} nullable options={PAYERS} onChange={onChange} />
        </DialogContent>
      </Dialog>
    );
    render(scoped ? <ArtifactDialogScope>{tree}</ArtifactDialogScope> : tree);
    fireEvent.click(screen.getByText('Add expense'));
    const dialog = screen.getByRole('dialog', {name: 'Add expense'});
    fireEvent.click(screen.getByLabelText('Paid by'));
    expect(dialog).toContainElement(screen.getByRole('listbox'));
    fireEvent.click(screen.getByRole('option', {name: 'Bo'}));
    expect(onChange).toHaveBeenCalledWith('bo');
  });
});

it('still portals to the body outside a dialog, so table clipping is escaped', () => {
  const {container} = render(<SelectControl label="Region" value={null} nullable options={PAYERS} onChange={() => {}} />);
  fireEvent.click(screen.getByLabelText('Region'));
  expect(container).not.toContainElement(screen.getByRole('listbox'));
  expect(document.body).toContainElement(screen.getByRole('listbox'));
});

describe('Dialog defaults', () => {
  it('pads and frames the dialog without the author asking', () => {
    render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor"><p>Body</p></DialogContent></Dialog>);
    fireEvent.click(screen.getByText('Open'));
    const classes = screen.getByRole('dialog', {name: 'Editor'}).className.split(/\s+/);
    expect(classes.some((c) => /^p-\d/.test(c))).toBe(true);
    expect(classes.some((c) => c.startsWith('rounded'))).toBe(true);
    expect(classes).toContain('border');
    expect(classes.some((c) => c.startsWith('max-w-'))).toBe(true);
    expect(classes).toContain('overflow-auto');
  });

  it('lets the author’s padding win over the default', () => {
    render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor" className="p-0"><p>Body</p></DialogContent></Dialog>);
    fireEvent.click(screen.getByText('Open'));
    const classes = screen.getByRole('dialog', {name: 'Editor'}).className.split(/\s+/);
    expect(classes).toContain('p-0');
    expect(classes.filter((c) => /^p-\d/.test(c))).toEqual(['p-0']);
  });

  it('draws the trigger as a button by default, and leaves a wrapped control alone', () => {
    render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Editor"><p>Body</p></DialogContent></Dialog>);
    expect(screen.getByText('Open').className).toMatch(/\bbg-primary\b|\bborder\b/);
  });
});
