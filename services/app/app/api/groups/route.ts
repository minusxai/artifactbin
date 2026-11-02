import {groupOperation} from '@/lib/group-routes';
export const GET=groupOperation('list_groups',true);
export const POST=groupOperation('create_group');
