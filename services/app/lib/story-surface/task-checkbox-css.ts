/** Saved checklist controls stay read-only in the reader without the browser's grey disabled skin.
 * The same sheet is served and used in edit mode; authored control styles may still override it.
 * The label also matches checklist source saved before this appearance rule existed.
 */
const TASK = ':where([data-mx-story-root]) input:where([type="checkbox"][aria-label="Task completed"])';

export const STORY_TASK_CHECKBOX_CSS = [
  `${TASK}{appearance:none;-webkit-appearance:none;display:inline-block;position:relative;box-sizing:border-box;width:13px;height:13px;margin:0;padding:0;vertical-align:-1px;border:1px solid #9ca3af;border-radius:2px;background:transparent;opacity:1;cursor:pointer}`,
  `${TASK}:checked{background:#087bff;border-color:#087bff}`,
  `${TASK}:checked::after{content:"";position:absolute;left:3px;top:0;width:4px;height:8px;border:solid white;border-width:0 2px 2px 0;transform:rotate(45deg)}`,
  `${TASK}:disabled{cursor:default;opacity:1}`,
  `${TASK}:focus-visible{outline:2px solid #087bff;outline-offset:2px}`,
  // Honor system high-contrast palettes while preserving an identifiable checked state.
  `@media (forced-colors:active){${TASK}{appearance:auto;-webkit-appearance:auto}${TASK}:checked::after{content:none}}`,
].join('');
