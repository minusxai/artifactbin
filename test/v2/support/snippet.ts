/**
 * Run a JavaScript example from the skill as written, with its
 * `import { … } from '<module>'` lines bound to the given module objects.
 * Top-level await works. Returns the values of `export const` declarations.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export async function runSnippet(
  code: string,
  modules: Record<string, Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const exported: string[] = [];
  const body = code
    .replace(
      /^\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?\s*$/gm,
      (_line, names: string, specifier: string) => {
        if (!(specifier in modules)) throw Error(`Snippet imports unknown module ${specifier}`);
        return `const {${names}} = __modules[${JSON.stringify(specifier)}];`;
      },
    )
    .replace(/^export\s+const\s+(\w+)/gm, (_line, name: string) => {
      exported.push(name);
      return `const ${name}`;
    });
  const run = new AsyncFunction(
    "__modules",
    `${body}\nreturn { ${exported.join(", ")} };`,
  );
  return (await run(modules)) as Record<string, unknown>;
}
