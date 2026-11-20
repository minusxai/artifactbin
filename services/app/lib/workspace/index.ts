/** The workspace module's interface: only what other modules import. */
export { VIEW_SERIES_DAYS, eventsTablePresent, forkCountByUser, likeSummaryByUser, viewSeriesByUser } from './analytics';
export { crumbsFor } from './breadcrumb';
export { groupArtifactsFor } from './group-artifacts';
export { accountWorkspaceCoreFor, accountWorkspaceFor, accountWorkspaceInsightsFor } from './dashboard';
export { homeBootstrapFor } from './home';
export { listArtifactsByUser, listOwnedArtifacts, listPublicArtifactsByUser } from './listings';
export type { SharedArtifactSummary } from './listings';
export { workspaceAssetsFor } from './inventory';
export { listTrashFor, ownedArtifactState, restoreArtifactFor, trashArtifactFor } from './trash';
export { agentStarterHtml, artifactStarter } from './artifact-starters';
export type { AccountWorkspace, AccountWorkspaceCore, AccountWorkspaceInsights, WorkspaceSharedItem } from './dashboard';
export { folderPageFor } from './folders';
export type { FolderPage } from './folders';
export type { HomeBootstrap } from './home';
export type { AssetSelection, WorkspaceAssets, WorkspaceStats } from './inventory';
export type { SharingVerdict } from './visibility-icons';

export {groupCollectionFor} from './group-collection';
