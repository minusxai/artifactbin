/** Optional deployment email capability. OSS owns authentication and notification eligibility. */
interface NotificationEmailPreferences {invitations:boolean;comments:boolean;activity:boolean}
export interface NotificationDelivery {
 sendGroupEmail?(message:GroupEmail):Promise<void>;
 preferences(userId:string):Promise<NotificationEmailPreferences>;
 updatePreferences(userId:string,preferences:NotificationEmailPreferences):Promise<NotificationEmailPreferences>;
 click(id:string):Promise<string|null>;
}
let delivery:NotificationDelivery|undefined;
export const setNotificationDelivery=(value:NotificationDelivery|undefined)=>{delivery=value;};
export const notificationDelivery=()=>delivery;

/** Idempotency key must be forwarded to the delivery provider; retries retain the same key. */
export interface GroupEmail {id:string;email:string;recipientId:string|null;groupId:string;groupName:string;handle:string;action:string;senderId:string}
