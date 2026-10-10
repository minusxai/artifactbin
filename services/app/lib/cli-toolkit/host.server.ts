/**
 * THE CLI'S CONTRACT WITH THE APP, PART 2: what the CLI's packaged host runtimes use — the local
 * preview and export host (`src/preview-entry.ts`, dist/runtime/preview.mjs) and the team host
 * (`src/team-application.ts`, dist/runtime/host.mjs). Node only.
 *
 * The local render pipeline and server wiring live here, never in `./index`: they import Babel,
 * Tailwind, sharp and the server configuration, which the `afbin` process bundle must not carry
 * (services/cli/src/host-runtime.ts loads these hosts as separate files for that reason).
 */

// ---- Compiled page: compile a document and assemble the reader page, as the hosted app does.
export { compilePage } from '../compiled-page/compiler';
export { assembleReaderPage } from '../compiled-page/assembler';
export { loadCompilerBuild } from '../compiled-page/build.server';
export { loadSsrModule } from '../compiled-page/bundle.server';
export { createModuleStore, createSpeculationRulesStore } from '../compiled-page/modules.server';
export { bindModuleCode } from '../compiled-page/runtime-binding';
export { documentStyleSheets } from '../compiled-page/styles';
export { withStoredCarriers } from '../compiled-page/carriers';
export { SPECULATION_RULES_HEADER } from '../compiled-page/contract';
export type { CompileInput, CompiledPage, CompilerBuild } from '../compiled-page/contract';

// ---- Story runtime: the prepared runtime, its island data and the document CSS.
export { prepareStoryRuntime } from '../publish/prepared/prepare-runtime.server';
export type { PreparedStoryRuntime } from '../publish/prepared/prepared-runtime';
export { ISLANDS_PATH } from '../story-runtime/contract';
export type { ServedResults, StoryIslandData } from '../story-runtime/contract';
export { compileStoryCss } from '../data/story/story-css.server';

// ---- Offline file: the self-contained `.html` artifact file's parts, HTML and fonts.
export { offlineFileParts } from '../offline/bundle.server';
export { renderArtifactFileHtml } from '../offline/file-html';
export { withoutUnusedFaces } from '../offline/font-faces';

// ---- Serving and export: fonts, social cards and the script render allowance.
export { DOCUMENT_UI_FONT_CSS } from '../serving/app-fonts';
export { CARD_HEIGHT, CARD_WIDTH } from '@artifactbin/contracts';
export { scriptModuleOrigins, scriptRenderAllowance } from '../export/script-origins';
export { renderSocialPreviewImage } from '../publish/assets/social-preview-image.server';

// ---- Team host: server configuration, services and accounts the team application composes.
export { EVENTS_SCHEMA, MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } from '../platform/config';
export { setServices } from '../platform/services';
export type { Db } from '../platform/db';
export { canAuthenticateUser } from '../accounts/user-kinds';

export {admitDeploymentIdentity,validateDeploymentConfiguration} from '../deployment';
