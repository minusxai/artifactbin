/** Home's wire projections; retention belongs to the shared PageDataStore. */
import type { AccountWorkspaceCore, AccountWorkspaceInsights } from '@/lib/workspace/dashboard';
import type { ShelfRow } from '@/lib/workspace/shelf';
export type HomeCore = ({ signedIn: true; accountId: string } & AccountWorkspaceCore) | { signedIn: false; drafts?: ShelfRow[] };
export type HomeInsights = AccountWorkspaceInsights & { signedIn: true; accountId: string };
