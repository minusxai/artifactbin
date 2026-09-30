/**
 * BINDING A STORED PAGE TO THE LIVE RUNTIME (contract MIN_HANDOVER_CONTRACT).
 *
 * A stored per-document browser module names the shared runtime by specifier only (`@mx/rt`,
 * `@mx/kit/tabs`); the content-addressed chunk URLs come from the manifest of the build that is serving.
 * Every serve therefore runs the newest shared chunks against the stored module, and a deploy that keeps
 * the contract number needs no recompile. The module URL carries the build (`?b=`) so a browser's
 * immutable cache can never hold a module bound to another build's chunks.
 */
import type { CompilerBuild, ModuleRef } from './contract';

const QUOTED = /(["'])((?:@mx\/|solid-js)[^"'\\\n]*)\1/g;

/** The module's bytes with every quoted shared specifier resolved to the build's chunk URL (author literals are externalised, so only imports match). */
export function bindModuleCode(code: string, build: CompilerBuild): string {
  return code.replace(QUOTED, (whole, quote: string, specifier: string) => {
    const url = build.manifest[specifier];
    return url ? `${quote}${url}${quote}` : whole;
  });
}

/** Specifiers the stored module needs that the live build does not carry: the page must be recompiled. */
export function unresolvedSpecifiers(ref: ModuleRef | null, build: CompilerBuild): string[] {
  return (ref?.specifiers ?? []).filter((specifier) => !build.manifest[specifier]);
}

/** The module ref as this build serves it: versioned URL, and the preload closure of the live chunks. */
export function bindModuleRef(ref: ModuleRef, build: CompilerBuild): ModuleRef {
  if (!ref.specifiers) return ref;
  const seen = new Set<string>();
  const visit = (url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    for (const next of build.graph?.[url] ?? []) visit(next);
  };
  for (const specifier of ref.specifiers) { const url = build.manifest[specifier]; if (url) visit(url); }
  return { ...ref, url: `${ref.url}?b=${build.id}`, imports: [...seen] };
}
