import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const lib = path.resolve(import.meta.dirname, '..');

describe('app auth owns only live policy', () => {
  it('has no retired admin-secret helper or app door-limiter adapter', () => {
    expect(existsSync(path.join(lib, 'rate-limiter/app.ts'))).toBe(false);
    const auth = readFileSync(path.join(lib, 'auth.ts'), 'utf8');
    expect(auth).not.toContain('hasAdminSecret');
    expect(auth).not.toContain('resetLimiter');
    expect(auth).not.toContain('ADMIN_SECRET');
  });
});
