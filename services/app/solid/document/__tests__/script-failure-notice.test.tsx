/* @jsxImportSource solid-js */
import { expect, it } from 'vitest';
import { within } from '@testing-library/dom';
import { render } from '../../__tests__/helpers';
import { ScriptFailureNotice } from '../ScriptFailureNotice';

it('tells a writer the builder\'s messages and that republishing with a fixed script resolves it, as a named status', () => {
  const errors = ['line 1:9: "reviewState" is not exported by "page"', 'line 1:40: reviewState(…) is not defined'];
  const view = render(() => <ScriptFailureNotice errors={errors} />);
  const region = view.getByRole('region', { name: 'Page script error' });
  const status = within(region).getByRole('status');
  expect(status).toHaveTextContent('Republish it with a fixed script to resolve this.');
  for (const error of errors) expect(within(status).getByText(error).tagName).toBe('CODE');
});
