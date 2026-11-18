/** Revoke a page's query approval (lib/operations query-approvals). */
import {groupOperation} from '@/lib/group-routes';
export const DELETE=groupOperation('revoke_query_approval');
