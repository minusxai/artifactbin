import { describe, expect, it } from 'vitest';
import { serviceSecretForServer } from '../src/service-auth';

describe('serviceSecretForServer', () => {
  it('requires authentication when a service boots in production', () => {
    expect(() => serviceSecretForServer({ NODE_ENV: 'production' })).toThrow(/INTERNAL__SERVICE_SECRET/);
    expect(serviceSecretForServer({ NODE_ENV: 'production', INTERNAL__SERVICE_SECRET: 'shared' })).toBe('shared');
  });

  it('retains an explicit unauthenticated development and test API', () => {
    expect(serviceSecretForServer({ NODE_ENV: 'development' })).toBeUndefined();
    expect(serviceSecretForServer({ NODE_ENV: 'test' })).toBeUndefined();
  });
});
