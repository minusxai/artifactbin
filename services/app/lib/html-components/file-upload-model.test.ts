import { expect, it } from 'vitest';
import { uploadError, uploadFile, uploadUrl } from './file-upload-model';
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

it('copies recognized safe metadata and rejects dangerous or credential-bearing URLs', () => {
  expect(uploadFile(null)).toBeNull(); expect(uploadFile({ ref: '', name: 'x' })).toBeNull();
  expect(uploadFile({ ref: 'a', name: '<script>', size: -1, secret: 'discard' })).toEqual({ ref: 'a', name: '<script>' });
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.org/x']) expect(uploadUrl(url, 'https://example.org')).toBeUndefined();
  expect(uploadUrl('/files/a', 'https://example.org')).toBe('https://example.org/files/a');
});
