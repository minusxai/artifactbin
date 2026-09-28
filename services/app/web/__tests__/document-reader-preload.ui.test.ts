/** The compiled story is adopted without loading the editor interpreter. */
import { expect, it, vi } from 'vitest';
const interpreter = vi.fn(async () => {});
vi.mock('../pages/Artifact', () => ({ ArtifactPage: () => null, preloadEditorStoryRuntime: interpreter }));
vi.mock('../pages/Profile', () => ({ ProfilePage: () => null }));
it('preloads route pages without importing the editor interpreter', async () => {
  const { preloadDocumentReader } = await import('../route-pages');
  await preloadDocumentReader();
  expect(interpreter).not.toHaveBeenCalled();
});
