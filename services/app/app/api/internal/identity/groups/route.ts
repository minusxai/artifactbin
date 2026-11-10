/** POST /api/internal/identity/groups — contracts `IDENTITY_PATHS.groups` (cross-repository contract §2). */
import {identityServiceRoute} from '@/lib/group-routes';
import {directGroups} from '@/lib/groups';
export const POST=identityServiceRoute(async body=>typeof body.user_id==='string'&&body.user_id?directGroups(body.user_id):null);
