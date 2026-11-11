/** Native document frame host shared by server and app navigation. */
export const STORY_FRAMED_ATTR = 'data-mx-framed';
/** The document frame's sandbox and permissions: the app page's frame (lib/document-serving/document-frame) and a host
 * page's (./host-shell) carry exactly these. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads';
export const FRAME_ALLOW = 'fullscreen; clipboard-write';
