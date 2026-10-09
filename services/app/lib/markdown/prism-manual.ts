/* Prism's browser core reads this flag before it schedules automatic document highlighting. */
if (typeof window !== 'undefined') {
  const scope = window as Window & { Prism?: { manual?: boolean } };
  scope.Prism ??= {};
  scope.Prism.manual = true;
}
