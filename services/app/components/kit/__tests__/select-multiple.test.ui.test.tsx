import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectControl } from '../controls';
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
});
