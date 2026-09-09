import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

vi.mock('@/components/SourceEditor', () => Promise.reject(new Error('Chunk unavailable')));
import LazySourceEditor from '../LazySourceEditor';
afterEach(() => vi.restoreAllMocks());

describe('failed rich-editor download', () => {
  it('keeps the source editable and preserves the current draft across a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Harness() {
      const [value, setValue] = useState('<p>Draft</p>');
      return <LazySourceEditor value={value} revision={0} onChange={setValue} />;
    }
    render(<Harness />);
    await screen.findByLabelText('Retry loading rich editor');
    fireEvent.change(screen.getByLabelText('Markup source'), { target: { value: '<p>Keep this</p>' } });
    fireEvent.click(screen.getByLabelText('Retry loading rich editor'));
    await waitFor(() => expect((screen.getByLabelText('Markup source') as HTMLTextAreaElement).value).toBe('<p>Keep this</p>'));
    await screen.findByLabelText('Retry loading rich editor');
  });
});
