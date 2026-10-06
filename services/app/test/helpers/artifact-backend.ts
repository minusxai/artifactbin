/**
 * Backends for tests: `httpBackend` drives the real HTTP requests through a stubbed `fetch`; tests
 * about a backend that cannot do something use `fakeBackend` and say which features it lacks.
 */
import { vi } from 'vitest';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import type { ArtifactBackend, BackendFeature } from '@/lib/artifact-backend/types';

const backends = new Map<string, ArtifactBackend>();
/** One backend per id for the whole file, as the page memoises it: a rerender must not re-subscribe. */
export const httpBackend = (id: string): ArtifactBackend => {
  let backend = backends.get(id);
  if (!backend) backends.set(id, backend = createHttpBackend(id));
  return backend;
};

/**
 * A backend whose missing features answer with a reason. Every request is a
 * spy that resolves to an empty answer unless the test overrides it.
 */
export function fakeBackend(
  missing: Partial<Record<BackendFeature, string>> = {},
  overrides: Partial<ArtifactBackend> = {},
): ArtifactBackend {
  return {
    mode: Object.keys(missing).length ? 'offline' : 'online',
    unavailable: (feature) => missing[feature] ?? null,
    load: vi.fn(async () => null),
    documentFrame: vi.fn(async () => null),
    commitEdit: vi.fn(async () => ({ ok: false, status: 503, body: {} as never })),
    prepare: vi.fn(async () => ({})),
    previewCss: vi.fn(async () => { throw new Error('no stylesheet'); }),
    previewQueries: vi.fn(async () => null),
    queryTable: vi.fn(async () => ({})),
    importImage: vi.fn(async () => ({ ok: false as const, error: 'unavailable' })),
    versions: vi.fn(async () => []),
    version: vi.fn(async () => null),
    revert: vi.fn(async () => ({ ok: false, status: 503, body: {} as never })),
    live: vi.fn(() => () => {}),
    liveFrame: vi.fn(async () => null),
    queryTransport: vi.fn(() => ({ run: async () => ({ tables: {}, errors: {} }), page: async () => { throw new Error('no rows'); }, dispose: () => {} })),
    listAnnotations: vi.fn(async () => []),
    createAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    actOnAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    deleteAnnotation: vi.fn(async () => {}),
    uploadCommentImage: vi.fn(async () => ({ id: 'img' })),
    members: vi.fn(async () => ({ people: [], mentions: {} })),
    remoteSessions: vi.fn(async () => ({ sessions: [] })),
    deleteRemoteSession: vi.fn(async () => {}),
    ...overrides,
  };
}
