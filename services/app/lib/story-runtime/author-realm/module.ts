/**
 * WHERE A REALM'S INTERPRETER COMES FROM. The QuickJS wasm is compiled once per page from bytes the
 * page fetched (its content-addressed `/islands/` URL, IslandPageData.quickjsWasm); each realm then
 * instantiates its OWN module over its OWN bounded `WebAssembly.Memory`. That is the one hard cap on an
 * allocation storm the spike found (the library's `setMemoryLimit` is per allocation), it confines an
 * aborted interpreter to one realm, and dropping the realm returns the memory. Costs under half a
 * millisecond per realm.
 */
import releaseVariant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import { AUTHOR_REALM_LIMITS } from './limits';

export type RealmWasm = WebAssembly.Module;

/** Compile the interpreter once; every realm on the page instantiates from this. */
export function compileRealmWasm(bytes: ArrayBuffer | Uint8Array): Promise<RealmWasm> {
  return WebAssembly.compile(bytes as BufferSource);
}

/** One interpreter instance over its own bounded memory, for one realm. */
export function newRealmModule(compiled: RealmWasm): Promise<QuickJSWASMModule> {
  const wasmMemory = new WebAssembly.Memory({ initial: AUTHOR_REALM_LIMITS.memoryInitialPages, maximum: AUTHOR_REALM_LIMITS.memoryMaximumPages });
  return newQuickJSWASMModuleFromVariant(newVariant(releaseVariant, { wasmModule: compiled, wasmMemory }));
}
