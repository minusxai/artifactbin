/** Trusted bootstrap for the standalone story document. Runtime ownership lives
 * in mountStory so the same lifecycle can be used by a SPA route. */
import { AUTHOR_SCRIPT_TYPE, STORY_ISLAND_ID, STORY_READY_EVENT, STORY_ROOT_ID, type StoryIslandData } from './contract';
import { createControlsFrame } from './controls-frame';
import { mountStory } from './mount';

const island = document.getElementById(STORY_ISLAND_ID);
const root = document.getElementById(STORY_ROOT_ID);
const appOrigin = new URL(import.meta.url).origin;

if (island?.textContent && root) {
  try {
    const data = JSON.parse(island.textContent) as StoryIslandData;
    const controls = data.controlsUrl && window.parent === window ? createControlsFrame(data.controlsUrl) : null;
    const parked = document.querySelector<HTMLScriptElement>(`script[type="${AUTHOR_SCRIPT_TYPE}"]`);
    const mounted = mountStory({
      root,
      data,
      renderMode: 'hydrate',
      authorScript: parked?.textContent ?? null,
      peer: controls?.frame.contentWindow ?? (window.parent !== window ? window.parent : undefined),
      peerOrigin: controls?.origin ?? appOrigin,
    });
    parked?.remove();
    window.addEventListener('pagehide', event => {
      if (!event.persisted) { mounted.dispose(); controls?.dispose(); }
    });
  } catch (err) {
    console.error('[story-runtime] hydration failed:', err);
    document.dispatchEvent(new Event(STORY_READY_EVENT));
  }
} else {
  document.dispatchEvent(new Event(STORY_READY_EVENT));
}
