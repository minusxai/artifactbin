/**
 * WebKit does not focus a button on mouse down, so pressing an option blurred
 * the search box with no related target and the list closed BEFORE the click
 * landed: in Safari a pick with the mouse did nothing (seen in the offline file
 * gate, scripts/gate-offline-file.mjs). The list keeps focus where it is on
 * mouse down instead; the click then chooses.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectControl } from '../controls';

afterEach(cleanup);

describe('SelectControl with a pointer', () => {
  it('does not move focus off the search box when an option is pressed, so the click still chooses', () => {
    const onChange = vi.fn();
    render(<SelectControl label="Region" options={[{ value: 'west', label: 'west' }, { value: 'east', label: 'east' }]} value={null} nullable onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Region' }));
    const option = screen.getByRole('option', { name: 'west' });
    // fireEvent returns false when the default action (moving focus) was prevented
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('west');
  });

  it('leaves the search box itself focusable by pointer', () => {
    render(<SelectControl label="Region" options={[{ value: 'west', label: 'west' }]} value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Region' }));
    expect(fireEvent.mouseDown(screen.getByRole('searchbox', { name: 'Search Region' }))).toBe(true);
  });
});
