/**
 * THE COMPILED PAGE's interface: what server code outside lib/compiled-page imports. Server-only, and
 * light on purpose: nothing here loads Babel, node:vm or vega, so a server or CLI start that serves
 * stored pages pays for none of them. The heavy halves are separate entries, each imported by its own
 * path where a caller means to pay for it (each file's header says why): `compilePage` (Babel; the
 * draft worker and preview, the CLI host, and prepared-page.server lazily), `loadSsrModule` and
 * `moduleToFunction` (Babel, Solid's server build, node:vm; serve.server lazily, the draft preview, the
 * offline assembler), and the recompile selector one maintenance script uses.
 * The offline file's browser-bundled code (lib/offline/file-html) imports the leaves agent-discovery,
 * carriers and story-element instead: the browser bundlers cannot drop the rest of this barrel.
 */

// ---- Contract: what a compile is given and produces, and what serving reads of it.
export {
  COMPILE_INLINE_BUDGET_MS, MIN_HANDOVER_CONTRACT, MIN_PAGE_FORMAT, isCompileFailure,
  type AssembleHead, type AssembleInput, type AssembleOverlay, type CompileInput, type CompiledPage, type CompilerBuild,
  type DataPlan, type DatasetAccessFacts, type ReaderFallbackReason, type StoredCompile,
} from './contract';

// ---- Wire ids: the headers and paths the server and its routes answer.
export { READER_MODE_HEADER, SPECULATION_RULES_HEADER, VIEWER_OVERLAY_PATH } from './contract';
export { SPECULATION_RULES_CONTENT_TYPE, SPECULATION_RULES_PATH } from './speculation';
export { TEMPLATE_RESOURCE_PATH } from './modules.server';
export { ISLANDS_MANIFEST_PATH } from './build.server';

// ---- Assembly: the reader page around a compiled version.
export { assembleReaderPage } from './assembler';
export { withStoredCarriers } from './carriers';
export { inlineStoryElement } from './story-element';
export { planOf } from './plan';
export { agentDiscovery, agentDiscoveryHead, withAgentDiscoveryTail } from './agent-discovery';

// ---- Build storage: the shared build, the per-document modules and their binding to the build.
export { loadCompilerBuild } from './build.server';
export { createModuleStore, createSpeculationRulesStore, createTemplateResourceStore } from './modules.server';
export { archiveSharedBuild, retainedBuild, retainedIslandFile } from './shared-builds.server';
export { bindModule, bindModuleCode, unresolvedSpecifiers } from './runtime-binding';
