/** Bundle dependencies retain authored browser resource behavior only in prototype mode. */
export interface CompiledBrowserImport {
  readonly external: boolean;
  readonly path: string;
}
export function validCompiledBrowserImports(
  imports: readonly CompiledBrowserImport[],
  prototype: boolean,
): boolean {
  return imports.every(
    (i) =>
      i.external &&
      (i.path === "@afbin/apollo" || (prototype && /^https:\/\//.test(i.path))),
  );
}
