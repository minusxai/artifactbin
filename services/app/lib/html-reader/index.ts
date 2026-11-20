/**
 * lib/html-reader's front door: what the app shell and the server take from the reader.
 *
 * It re-exports only files the app shell's eager chunks already hold (the protocol constants, the reader's theme
 * pick, the document endpoint, the bar sizes and the frame's markup), because the app's bundler keeps every file a
 * barrel re-exports. The lazily loaded parts each have a door of their own, along the chunks the app already has:
 * `framed-story` (the frame bridge's parent side, navigation and session, for solid/document/create-framed-story),
 * `frame-src` and `follow-version` (one file each, each its own chunk). The frame runtime's esbuild bundles take
 * the `contract` and `ast-path` leaves, and lib/page-styles the `document-sources` leaf; host-shell is /af/host.js's
 * entry and is built, not imported.
 */
export {
  STORY_READER_MODE_MESSAGE, STORY_FRAME_HASH_MESSAGE, STORY_URL_VALUES_MESSAGE, STORY_DATA_EVENT, STORY_ANNOTATIONS_EVENT,
  THEME_KEY, withReaderMode,
} from './contract';
export type {
  StoryController, IslandStoryController, FrameBridgeFramePayload, ArtifactDataEvent, ArtifactVersionPing, ArtifactLiveEvent,
} from './contract';
export { chooseTheme, storedTheme } from './reader-mode';
export { sendDocument, subscribeDocument, documentRect, type DocumentRuntimeRef } from './document-endpoint';
export { APP_BAR_H, RIGHT_RAIL_W, REGION_TOOLBAR_H } from './edit-bar';
export { STORY_FRAMED_ATTR, FRAME_SANDBOX, FRAME_ALLOW } from './frame-markup';
export type { HostComments, HostCommentsOptions, HostMode } from './host-comments-contract';
export type { FrameBridgeParent } from './frame-bridge/parent';
