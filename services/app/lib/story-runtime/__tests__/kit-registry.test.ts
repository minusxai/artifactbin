/**
 * The kit registry the runtime draws from (lib/story-runtime/kit-registry) is
 * the static registry (lib/story-ui/registry) split into chunks: every tag in
 * exactly the chunk the names-only table places it in, every face the same
 * component, and every chunk reachable through its own loader.
 */
import { describe, expect, it } from 'vitest';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { KIT_CHUNKS, KIT_CHUNK_IDS, type KitChunkId } from '@/lib/story-ui/kit-chunks';
import { ALL_KIT_CHUNKS } from '../kit/all';
import { CORE_FACES, kitComponents, kitLoaded, loadKitChunks, resetKitRegistry } from '../kit-registry';

/** Faces whose registry entry is an inline stand-in (no identity to share): compared by presence. */
const INLINE = new Set(['For', 'Column']);

describe('the kit, split per chunk', () => {
  it('draws every static face the registry names, with the same component', () => {
    const faces: Record<string, unknown> = { ...CORE_FACES, ...Object.values(ALL_KIT_CHUNKS).reduce((all, chunk) => ({ ...all, ...chunk.faces }), {}) };
    expect(Object.keys(faces).sort()).toEqual(Object.keys(STORY_UI_COMPONENTS).sort());
    const differ = Object.keys(STORY_UI_COMPONENTS).filter((tag) => !INLINE.has(tag) && faces[tag] !== STORY_UI_COMPONENTS[tag]);
    expect(differ).toEqual([]);
  });

  it('puts each tag in the chunk the names-only table places it in', () => {
    for (const id of KIT_CHUNK_IDS) {
      const chunk = ALL_KIT_CHUNKS[id];
      const drawn = new Set([...Object.keys(chunk.faces), ...Object.keys(chunk.live ?? {})]);
      expect([...drawn].sort(), id).toEqual([...KIT_CHUNKS[id].tags].sort());
    }
  });

  it('loads a chunk through its own loader, registering exactly it, and forgets nothing it did not load', async () => {
    resetKitRegistry();
    expect(kitLoaded(['badge'])).toBe(false);
    await loadKitChunks(['badge', 'controls']);
    expect(kitLoaded(['badge', 'controls'])).toBe(true);
    const others = KIT_CHUNK_IDS.filter((id) => id !== 'badge' && id !== 'controls' && kitLoaded([id]));
    expect(others).toEqual([]);
    const kit = kitComponents();
    expect(kit.faces.Badge).toBe(STORY_UI_COMPONENTS.Badge);
    expect(kit.faces.Card).toBeUndefined();
    expect(kit.live.Select).toBe(ALL_KIT_CHUNKS.controls.live?.Select);
    expect(kit.cells).toBe(ALL_KIT_CHUNKS.controls.cells);
  });

  it('reaches every chunk through a loader', async () => {
    resetKitRegistry();
    await loadKitChunks(KIT_CHUNK_IDS as KitChunkId[]);
    expect(kitLoaded(KIT_CHUNK_IDS)).toBe(true);
  });
});

it('ignores an id this build has no chunk for, as a page served by another build may name', async () => {
  resetKitRegistry();
  await loadKitChunks(['no-such-chunk', 'badge']);
  expect(kitLoaded(['badge'])).toBe(true);
});
