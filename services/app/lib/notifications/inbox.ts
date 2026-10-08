import type { MutationNotificationView } from '@artifactbin/contracts';

/** A member notification (invitation, request, follow, reply…) as `GET /api/my/notifications` returns it. */
export interface MemberNotificationItem {id:string;artifact_id:string|null;user_id:string;status:string|null;direction:string|null;sender_id:string;username:string|null;kind:string;source:string|null;title:string|null;read_at:string|null;revision:number;created_at?:string;first_update_id?:string|null;agent_label?:string|null}
/** The notification inbox as the page reads it: member notifications and mutation summaries. */
export type InboxItem = MemberNotificationItem | (MutationNotificationView & {source?:null});
export const isMutationNotification = (item:InboxItem): item is MutationNotificationView & {source?:null} => 'actor' in item;
export interface InboxState {autoAccept:boolean;notifications:InboxItem[];blocks:Array<{user_id:string;username:string|null}>;unread:number;next:number|null}
