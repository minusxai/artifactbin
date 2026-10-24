import { expect, it } from 'vitest';
import { uploadError } from './file-upload-model';
const policy = { multiple: true, accept: '.png,image/*', maxFiles: 10, maxBytes: 50_000_000 };
it('validates file count, byte limits, and case insensitive extensions and MIME wildcards', () => {
  const file = { name: 'PHOTO.PNG', type: '', size: 50_000_000 } as File;
  expect(uploadError([file], 9, policy)).toBe('');
  expect(uploadError([file], 10, policy)).toContain('at most 10');
  expect(uploadError([{ ...file, size: 50_000_001 } as File], 0, policy)).toContain('50 MB');
  expect(uploadError([{ ...file, name: 'x.txt' } as File], 0, policy)).toContain('accepted');
  expect(uploadError([file], 10, { ...policy, multiple: false })).toBe('');
  expect(uploadError([file, file], 0, { ...policy, multiple: false })).toContain('at most 1');
});
