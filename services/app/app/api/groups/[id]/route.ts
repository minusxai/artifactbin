import {groupOperation} from '@/lib/group-routes';
export const GET=groupOperation('get_group',true);
export const PATCH=groupOperation('update_group');
export const DELETE=groupOperation('delete_group');
