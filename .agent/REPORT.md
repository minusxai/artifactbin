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
