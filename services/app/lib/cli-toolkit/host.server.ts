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
export {
  assembleReaderPage, bindModuleCode, type CompiledPage, type CompileInput, type CompilerBuild,
  createModuleStore, createSpeculationRulesStore, loadCompilerBuild, SPECULATION_RULES_HEADER,
  withStoredCarriers,
} from '../compiled-page';
export { loadSsrModule } from '../compiled-page/bundle.server';
export { documentStyleSheets } from '../page-styles';

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
export { canAuthenticateUser } from '../accounts';
