/** The admitted cell grammar always supplies authored options; no ambient user directory is available. */
export function archivedExplicitCellOptionsSource(source: string): string {
  const seed =
    "const [userOptions, setUserOptions] = createSignal(store?.getState().userOptions);";
  const watch =
    "if (store && !isServer) onCleanup(store.subscribe(() => setUserOptions(() => store.getState().userOptions)));";
  if (source.split(seed).length !== 2 || source.split(watch).length !== 2)
    throw Error("Unsupported archived cell options source");
  return source
    .replace(seed, "const [userOptions] = createSignal(undefined);")
    .replace(watch, "");
}
