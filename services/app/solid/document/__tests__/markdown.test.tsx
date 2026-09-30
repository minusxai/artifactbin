/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentMarkdown, CommentMarkdownField } from '../CommentMarkdown';

it('renders fenced code, lists, safe links, and literal unsafe links as text', () => {
  const view = render(() => <CommentMarkdown text={'A list:\n- one\n- two\n\n```js\nconst x = 1\n```\n\n[Open](https://example.com) [bad](javascript:alert(1))'} />);
  expect(view.container.querySelector('li')).toHaveTextContent('one');
  expect(view.container.querySelector('pre')).toHaveTextContent('const x = 1');
  expect(view.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank');
  expect(view.queryByRole('link', { name: 'bad' })).toBeNull();
  expect(view.container).toHaveTextContent('[bad](javascript:alert(1))');
});

it('wraps selected markdown and submits the raw text on command-enter', () => {
  const changed = vi.fn(); const submitted = vi.fn();
  const view = render(() => <CommentMarkdownField label="Annotation comment" value="middle" onChange={changed} onSubmit={submitted} />);
  const field = view.getByRole('textbox', { name: 'Annotation comment' }) as HTMLTextAreaElement;
  field.setSelectionRange(0, 6);
  fireEvent.click(view.getByRole('button', { name: 'Bold' }));
  expect(changed).toHaveBeenCalledWith('**middle**');
  fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
  expect(submitted).toHaveBeenCalledTimes(1);
});
