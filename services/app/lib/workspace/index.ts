/** The workspace module's interface: only what other modules import. */
export { VIEW_SERIES_DAYS, dailyViewsByUser, eventsTablePresent, forkCountByUser, likeSummaryByUser, viewSeriesByUser } from './analytics';
export { crumbsFor } from './breadcrumb';
export { accountWorkspaceCoreFor, accountWorkspaceFor, accountWorkspaceInsightsFor } from './dashboard';
export { fileNameFromUrl, formatFileSize } from './file-display';
export { childrenTableFor } from './folders';
export { formatJsxPreview } from './format-jsx-preview';
export { workspaceAssetsFor } from './inventory';
export { buildShelf, groupShelfByRecency } from './shelf';
export type { ShelfItem } from './shelf';
export { listTrashFor, ownedArtifactState, restoreArtifactFor, trashArtifactFor } from './trash';
