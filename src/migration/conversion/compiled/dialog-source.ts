/** Exact frozen Dialog adapter. Unknown archived implementations fail closed. */
export function archivedDialogFocusSource(
  source: string,
  helperPath: string,
): string {
  const original = `requestAnimationFrame(() => {
          if (dialog.open) (dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])'))?.focus();
        });`;
  if (source.split(original).length !== 2)
    throw Error("Unsupported archived dialog autofocus");
  const replacement = `onCleanup(scheduleDialogOpeningFocus({
          schedule: callback => requestAnimationFrame(callback),
          activeElement: () => document.activeElement,
          isOpen: () => dialog.open,
          focusInitial: () => { (dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])'))?.focus(); }
        }));`;
  return (
    `import {scheduleDialogOpeningFocus} from ${JSON.stringify(helperPath)};\n` +
    source.replace(original, replacement)
  );
}
