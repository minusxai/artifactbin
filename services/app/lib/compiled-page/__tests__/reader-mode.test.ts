import { describe, expect, it } from 'vitest';
import { compiledReaderForView } from '../reader-mode';

describe('compiledReaderForView', () => {
  it('uses the compiled reader for document views', () => {
    expect(compiledReaderForView()).toBe(true);
  });
  it('keeps editing and commenting on their dedicated paths', () => {
    expect(compiledReaderForView({ editing: true })).toBe(false);
    expect(compiledReaderForView({ commenting: true })).toBe(false);
  });
});
