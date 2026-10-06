/** Dispose roots, then drain lazy routes before another file can reuse their module graph. */
import { cleanup as cleanupLibrary } from '@solidjs/testing-library';
import { vi } from 'vitest';
import { cleanup as cleanupHelpers } from '@/solid/__tests__/helpers';

export async function cleanupSharedJsdom(): Promise<void> {
  cleanupHelpers();
  cleanupLibrary();
  // A redirected/disposed Solid lazy route still finishes importing its dependencies.
  // Keep this environment alive until those imports finish, rather than suppressing teardown errors.
  await vi.dynamicImportSettled();
}
