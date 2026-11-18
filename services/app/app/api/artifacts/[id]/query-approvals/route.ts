/** A page's approved queries (lib/operations query-approvals): list for an Admin of its group, and approve one. */
import {groupOperation} from '@/lib/group-routes';
export const GET=groupOperation('list_query_approvals',true);
export const POST=groupOperation('approve_query');
