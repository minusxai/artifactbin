/**
 * Backends for tests: `httpBackend` drives the real HTTP requests through a stubbed `fetch`; tests
 * about a backend that cannot do something use `fakeBackend` and say which features it lacks.
 */
import { vi } from 'vitest';
import type { ArtifactBackend, BackendFeature } from '@/lib/artifact-backend';

/**
 * A backend whose missing features answer with a reason. Every request is a
 * spy that resolves to an empty answer unless the test overrides it.
 */
export function fakeBackend(
  missing: Partial<Record<BackendFeature, string>> = {},
  overrides: Partial<ArtifactBackend> = {},
): ArtifactBackend {
  return {
    publishPresence: vi.fn(async () => null),
    mode: Object.keys(missing).length ? 'offline' : 'online',
    unavailable: (feature) => missing[feature] ?? null,
    load: vi.fn(async () => null),
    documentFrame: vi.fn(async () => null),
    importImage: vi.fn(async () => ({ ok: false as const, error: 'unavailable' })),
    versions: vi.fn(async () => []),
    version: vi.fn(async () => null),
    revert: vi.fn(async () => ({ ok: false, status: 503, body: {} as never })),
    live: vi.fn(() => () => {}),
    liveFrame: vi.fn(async () => null),
    listAnnotations: vi.fn(async () => []),
    createAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    actOnAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    setCommentReaction: vi.fn(async () => { throw new Error('not stubbed'); }),
    editAnnotation: vi.fn(async () => { throw new Error('not stubbed'); }),
    deleteAnnotation: vi.fn(async () => {}),
    uploadCommentImage: vi.fn(async () => ({ id: 'img' })),
    members: vi.fn(async () => ({ people: [], mentions: {} })),
    ...overrides,
  };
}
