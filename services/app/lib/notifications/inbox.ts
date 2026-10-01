import type { MutationNotificationView } from '@artifactbin/contracts';

/** The notification inbox as the page reads it (GET /api/my/notifications). */
export interface LegacyInboxItem {id:string;artifact_id:string|null;user_id:string;status:string|null;direction:string|null;sender_id:string;username:string|null;kind:string;source:string|null;title:string|null;read_at:string|null;revision:number;created_at?:string;first_update_id?:string|null}
export type InboxItem = LegacyInboxItem | (MutationNotificationView & {source?:null});
export interface InboxState {autoAccept:boolean;notifications:InboxItem[];blocks:Array<{user_id:string;username:string|null}>;unread:number;next:number|null}
