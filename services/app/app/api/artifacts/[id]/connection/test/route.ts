import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
/** POST `test_live_connection`: "Test connection" on a saved live dataset (owner and editors), within the hourly allowance. */
export const POST = withAgentOrBrowserAuth((request, { actor, params }) => runOperation('test_live_connection', request, actor, { id: params.id }));
