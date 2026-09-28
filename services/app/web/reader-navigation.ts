/** A client route cannot manufacture a served compiled story root. */
export const readerNavigation = {
  open(url: string): void { window.location.assign(url); },
};
