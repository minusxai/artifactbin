/** Home's wire projections; retention belongs to the shared PageDataStore. */
import type { AccountWorkspaceCore, AccountWorkspaceInsights, ShelfRow } from '@/lib/workspace';
export type HomeCore = ({ signedIn: true; accountId: string } & AccountWorkspaceCore) | { signedIn: false; drafts?: ShelfRow[] };
export type HomeInsights = AccountWorkspaceInsights & { signedIn: true; accountId: string };
/** Home's first request: the effective destination and what it renders (see lib/workspace/home). */
export type { HomeBootstrap } from '@/lib/workspace';
export const homeBootstrapKey = (personal: boolean): string => `/api/page/home?part=bootstrap${personal ? '&personal=1' : ''}`;
