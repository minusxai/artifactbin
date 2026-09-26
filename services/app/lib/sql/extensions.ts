/**
 * THE COMPOSITION'S SQL EXTENSIONS, for the SQL the app analyzes itself. A
 * composition root declares ONE module (`AppHostOptions.sqlExtensions`) — the
 * specifier its SQL pool receives (`createSql(caps, { extensions })`) — and its
 * default export (`SqlExtensions`) is installed wherever the app prepares a
 * <Mutation> in this process: the publish checks (lib/story/compile-dataflow)
 * and the owner's direct write (lib/story/dataset-mutate). Reads never see it.
 *
 * Kept on `globalThis`, like the services registry: a root registers once per
 * process, and a module reload in a test must not silently drop it.
 */
import type { SqlExtensions } from '@artifactbin/sql/core';

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_sql_extensions__: SqlExtensions | undefined;
}

/** Load the module a composition root names (an absolute URL or a package name); none clears it. */
export async function useSqlExtensions(module: string | undefined): Promise<void> {
  globalThis.__artifact_bin_sql_extensions__ = module ? ((await import(module)) as { default?: SqlExtensions }).default ?? {} : undefined;
}

export const sqlExtensions = (): SqlExtensions => globalThis.__artifact_bin_sql_extensions__ ?? {};
