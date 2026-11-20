/**
 * The door to a framed story's parent side, for solid/document/create-framed-story's lazy chunk: the frame bridge's
 * parent, the frame's navigation and its session. Only that chunk imports it, so the barrel adds nothing to the
 * shell (the shell's door is this module's index).
 */
export { createFrameBridgeParent } from './frame-bridge/parent';
export { answerFrameNavigation } from './frame-navigation';
export { keepFrameSession } from './frame-session';
