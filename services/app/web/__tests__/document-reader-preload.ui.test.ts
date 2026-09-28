/**
 * THE FIRST RENDER'S CODE (web/route-pages preloadDocumentReader): today's served story is hydrated
 * by the inline interpreter, so its code is awaited before the first render; a COMPILED story is
 * adopted as it is, islands running, so the interpreter loads only when edit mode is entered.
 */
import { afterEach, expect, it, vi } from 'vitest';

const interpreter = vi.fn(async () => {});
vi.mock('../pages/Artifact', () => ({ ArtifactPage: () => null, preloadInlineStoryRuntime: interpreter }));
vi.mock('../pages/Profile', () => ({ ProfilePage: () => null }));

afterEach(() => interpreter.mockClear());

it('preloads reader pages without the editor interpreter', async () => {
  const { preloadDocumentReader } = await import('../route-pages');
  await preloadDocumentReader();
  expect(interpreter).not.toHaveBeenCalled();
});
