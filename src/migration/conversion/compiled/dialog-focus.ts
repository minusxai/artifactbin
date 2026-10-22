import type { DialogOpeningFocus } from "./dialog-focus-contracts.ts";
/** A queued opening may choose initial focus only while it still owns focus. */
export function scheduleDialogOpeningFocus(
  ports: DialogOpeningFocus,
): () => void {
  const initial = ports.activeElement();
  let retired = false;
  ports.schedule(() => {
    if (!retired && ports.isOpen() && ports.activeElement() === initial)
      ports.focusInitial();
  });
  return () => {
    retired = true;
  };
}
