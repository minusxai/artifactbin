import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
/** GET `get_live_schema`: the tables and columns a live dataset's account reads (owner and editors; `sql.mjs schema ID`). */
export const GET = withAgentOrBrowserAuth((request, { actor, params }) => runOperation('get_live_schema', request, actor, { id: params.id }));
