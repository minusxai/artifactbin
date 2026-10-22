/** Focus belongs to the reader once it changes after modal opening. */
export interface DialogOpeningFocus {
  schedule(callback: () => void): void;
  activeElement(): Element | null;
  isOpen(): boolean;
  focusInitial(): void;
}
