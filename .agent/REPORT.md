# Shared hosted/local/offline UI implementation

Implemented in `artifactbin-next-shared-ui`, branch `fix-offline-shared-ui`.

## Shared boundaries

- `PageBar` and `PageControlsPanel` now provide the actual hosted geometry to hosted pages, portable files, npm previews, and the preview import receiver. The real 28px artifactbin PNG is embedded into portable/preview bundles; unpublished files have no reload/live link.
- `DocumentBarActions` owns Comment/Edit and capability-specific icon actions. Existing `DocumentActions.tsx` owner/sharing/download/delete functionality is unchanged.
- `EditorChrome` shares the hosted toolbar, keyboard-accessible view tabs and source-panel rail reservation. Both local surfaces use existing `SourceEditorPane`; portable extras availability is an explicit tools-provider capability.
- `FormControls` extracts existing Login input/primary button presentation; Login, preview receiver and portable name/Connect forms consume it.
- `createDocumentViewport` reserves bar/editor height and the desktop comment rail, restores original body styles on disposal, and leaves the document full width for the shared phone sheet.
- Portable comments use the actual `AnnotationLayer`/`AnnotationThread`/`RailChrome` with the existing file backend, through a small local annotation controller and name adapter. Removed duplicate thread/reply/resolve/composer UI. Cancelled name requests retain shared-composer drafts.

## Trust and persistence

Portable chrome and comments now mount in actual TrustedUi shadow/top-layer boundaries configured from embedded first-party app CSS. Document base/compiled/author CSS remains outside those boundaries. Preview fetches its own same-origin chrome CSS and configures the boundary before mounting; no app CSS is linked into the author document. Selection portals are protected. Shared dialogs provide Escape, focus trapping/restoration, including crash recovery alertdialog. Save/shortcut/flush/receipt/handle reuse/concurrent-write and Connect security/persistence contracts remain covered.

No production calls or auth flows were added to the portable adapter. Preview remains a same-origin local/remote preview service. CodeMirror/formatter still require the existing integrity-pinned extras for portable files; offline fallback stays editable and explains unavailable capability.

## Observed verification

- Seed RED: offline-file suite failed the TrustedUi/shared-bar regression (1 failed, 28 passed); `/tmp/afbin-shared-ui-seed-red.log`.
- Final FAST: `npm run validate` passed; `/tmp/afbin-shared-ui-final-validate.log`. Concurrent generated-input changes prevented receipt caching; this is actual successful validation, not reused evidence.
- Final scoped tests: nine files passed, 58 UI tests and 30 CLI tests; `/tmp/afbin-shared-ui-scoped4.log`. Files: offline-file, document-chrome, in-place-editor, source-editor-pane, source-editor-pane-lifecycle, CLI preview, preview-policy, preview-render, preview-connect.
- New behavioral coverage includes shared protected bar, no unpublished reload link, reply/resolve/save/reopen with names, cancelled reply identity draft retention, desktop source/document rail reservation→phone sheet on resize, and Connect Escape/focus restoration. Existing shortcut/save races, invalid source, crash recovery and Connect spoof tests remain.
- Gate/native journey assertions updated for shared accessible labels, settings-menu navigation and CodeMirror contenteditable buffers. Offline gate now injects hostile author CSS and checks real shadow isolation plus 44px bar/36px Comment/8px radius. Syntax checks for both gate/journey scripts passed; `git diff --check` passed.
- Parent owns actual browser QA. Parent reported real-browser matching hosted chrome metrics under hostile CSS, successful edit/Done, comment/reply/resolve and Connect offer transfer. Those are parent observations, not implementer-run end-to-end claims.

## Remaining orchestrator checks

No build, gate, push, CI, merge, npm publish or deploy run by implementer. Root owns complete three-engine gate/native installed npm journey and hosted/local/offline browser verification, built bundle size/trust review, CI/release/deploy. Reuse brings more existing AnnotationLayer code into portable core; measure actual bundle size in root's final build. Six root-owned 0.4.3 release files are preserved in the commit.

## Corrective CI/browser review handoff

Parent's first final run exposed stale preview-toolbar/native-experience selectors plus a WebKit source-persistence gate failure and Firefox source locator replacement. Updated every identified consumer (`preview-toolbar.ui`, `test-preview.ts`, npm local journey and offline gate): shared shadow-aware Edit→Code flow, actual rich-editor readiness, then source-adapter Unsaved/live-document projection before Done, retaining final reload/disk assertions. A real CodeMirror behavioral test proves native DOM input initially precedes its model callback and is subsequently published through the DOM observer. No private observer APIs, sleeps, timer increases or blind retries added.

Parent browser review found the embedded receiver brand was blocked by its CSP and receiver spacing classes were not in the app-scanned stylesheet. `FormPage`, extracted from the existing Login container, now supplies receiver/login spacing from the shared scanned boundary. Receiver CSP admits only `data:` images while retaining external-resource denial. New policy test observed RED (1 failed, 9 passed) before the policy fix. Receiver's mount is a div with a fallback main so the interactive page has one real banner/main. Gate asserts actual logo decode/28px geometry, form-page spacing and landmarks. It also verifies real 390px toolbar geometry and usable comment sheet/source draft retention.

Final corrective FAST validation passed (`/tmp/afbin-shared-ui-corrective-final-validate.log`). All eleven scoped files passed **70 UI + 31 CLI tests** (`/tmp/afbin-shared-ui-corrective-final-scoped.log`), now including preview-toolbar and source-editor behavior. Gate/journey syntax and diff checks passed. Parent owns the single corrective failed-gate verification and push/CI; no gate or push run by implementer. Readiness-based gate correction still requires that end-to-end confirmation; local unit evidence does not claim WebKit integration passed.

## Compiled-editor startup readiness correction

Parent's corrective browser run reproduced Code not mounting intermittently and a separate WebKit native-input issue. Inspection identified the concrete startup race: the new Edit→Code flow could send `STORY_COMMIT` while the controller's lazy compiled mount was still loading; that message had no receiver and timed out. Preview Code/Done now honor the existing `edit.ready()` contract, with Opening editor status while pending and failure messages preserved. Shared view tabs accept disabled capabilities, skip them for keyboard navigation, and safely return when none are enabled.

Behavioral startup regression observed RED (1 failed, 5 passed; `/tmp/afbin-shared-ui-startup-ready-red.log`) before implementation, then GREEN. Final FAST validation passed (`/tmp/afbin-shared-ui-startup-complete-validate.log`). Final eleven scoped files passed 71 UI + 31 CLI tests (`/tmp/afbin-shared-ui-startup-complete-scoped.log`): offline-file, document-chrome, preview-toolbar, in-place-editor, source-editor, source-editor-pane, source-editor-pane-lifecycle; CLI preview, preview-policy, preview-render, preview-connect. Gate syntax and diff checks passed.

Browser diagnostics now print directly through checker notes (the lane truncates thrown stacks), preserving exact pre/post-fill source, selected tabs, statuses, shadow DOM/editor, active element, server source, CSP, console/errors and bundle/draft response evidence. A bounded WebKit native End/Space probe reports whether actual input publishes the failed DOM-only fill; it always rethrows the original failure. The WebKit input issue is intentionally still unclaimed until root's diagnostic gate produces actual evidence. No gate or push run by implementer.

## Native source input, CSP and actual font parity completion

Parent's diagnostic browser evidence showed WebKit `fill()` left the CodeMirror DOM exactly unchanged (focused editor, ready tab, all chunks 200). The bounded End/Space probe did publish Unsaved for the original source. The gate and both installed-preview journeys now bring the editor forward and use real select-all/keyboard insertion, retaining Unsaved, live heading, Done, reload and disk assertions. Removed the failure-only native probe; failure-state diagnostics remain. Actual WebKit completion is still owned by root's final gate.

Preview's two first-party base tags violated its existing `base-uri 'none'` policy. A narrow shared assembler `navigationTarget: null` capability omits the framed navigation override for previews; default hosted `_top` behavior remains tested. Removed preview's unnecessary href base; the existing canonical workspace redirect already resolves neighboring assets. Meaningful assembler test observed RED then GREEN; assembler/default and preview contracts passed. This correction is commit f1864f59.

Real font parity now reuses the hosted font manifest and extracted pure formatter. Hosted output remains unchanged. Unframed document controls use only JetBrains Mono Variable and IBM Plex Sans global font-face definitions, separate from TrustedUi selector CSS. Preview adds global font-only rules; the receiver loads generated fonts.css and admits only same-origin fonts. Hosted and local offline exports add these same definitions to existing base CSS before per-file unicode subset filtering and current font byte inlining. File title, comments and downloader names participate in text selection; Latin UI text is retained by the existing filter. No file-format keys added. Font regression observed RED in actual hosted offline assembly, then GREEN for both export paths. Proof includes actual embedded WOFF2 magic and absence of remote font URLs; generated receiver sheet contains only font definitions.

The browser gate now calls document.fonts.load for both UI families and requires nonempty arrays of actual loaded FontFaces, on the standalone file, its saved/reopened copy, the receiver and the server preview. Existing offline network-denial assertions remain. Preview CSP violations are asserted before saving/reload, so first-load violations cannot disappear on navigation. These are runnable assertions, not claims of browser results.

Final FAST validation passed (/tmp/afbin-shared-ui-font-final-validate.log). The complete scoped 16-file run passed 125 Vitest tests across 11 files plus 38 CLI tests across 5 files (/tmp/afbin-shared-ui-final-font-scoped.log), including the hosted built-shell font contract, both assembler files, offline API assembly, local HTML export and all prior affected UI/preview tests. JS syntax and diff checks passed. No gate, push, CI, merge, release publication or deploy run by implementer; root owns final end-to-end confirmation.
