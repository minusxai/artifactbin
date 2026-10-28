import { afterEach, expect, it, vi } from 'vitest';
import { thrownMessage } from '../http';

afterEach(() => vi.restoreAllMocks());
it('returns an Error message unchanged', () => {
  expect(thrownMessage(new TypeError('Missing <title>'), 'Invalid HTML')).toBe('Missing <title>');
});
it('logs any other thrown value and answers with the fixed fallback', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const thrown = { stack: 'at internal (/srv/app.js:1:1)' };
  expect(thrownMessage(thrown, 'Invalid HTML')).toBe('Invalid HTML');
  expect(thrownMessage('raw text', 'Invalid backend')).toBe('Invalid backend');
  expect(log).toHaveBeenCalledWith('[http] non-Error thrown:', thrown);
});
