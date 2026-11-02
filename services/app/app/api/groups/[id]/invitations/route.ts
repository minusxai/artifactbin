import {groupOperation} from '@/lib/group-routes';
export const GET=groupOperation('list_group_invitations',true);
export const POST=groupOperation('invite_group_member');
