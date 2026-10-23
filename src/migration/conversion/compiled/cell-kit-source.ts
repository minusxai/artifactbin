/** Only registered user choices can supplement authored options; never an ambient directory. */
export function archivedExplicitCellOptionsSource(source: string, registeredUserChoices=false): string {
  const seed =
    "const [userOptions, setUserOptions] = createSignal(store?.getState().userOptions);";
  const watch =
    "if (store && !isServer) onCleanup(store.subscribe(() => setUserOptions(() => store.getState().userOptions)));";
  if (source.split(seed).length !== 2 || source.split(watch).length !== 2)
    throw Error("Unsupported archived cell options source");
  return source
    .replace(seed, registeredUserChoices ? "const userOptions=()=>island.cellUserOptions?.()??{};" : "const [userOptions] = createSignal(undefined);")
    .replace(watch, "");
}
