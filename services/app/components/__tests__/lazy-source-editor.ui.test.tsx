import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

vi.mock('@/components/SourceEditor', () => new Promise(() => {}));
import LazySourceEditor from '../LazySourceEditor';

describe('progressive source editor', () => {
  it('keeps source readable and editable while the rich editor is downloading', async () => {
    function Harness() {
      const [value, setValue] = useState('<p>Draft</p>');
      return <LazySourceEditor value={value} revision={0} onChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Markup source');
    expect((input as HTMLTextAreaElement).value).toBe('<p>Draft</p>');
    fireEvent.change(input, { target: { value: '<p>Still editable</p>' } });
    await waitFor(() => expect((screen.getByLabelText('Markup source') as HTMLTextAreaElement).value).toBe('<p>Still editable</p>'));
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });
});
