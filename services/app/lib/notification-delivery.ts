/** Optional deployment email capability. OSS owns authentication and notification eligibility. */
export interface NotificationEmailPreferences {invitations:boolean;comments:boolean;activity:boolean}
export interface NotificationDelivery {
 preferences(userId:string):Promise<NotificationEmailPreferences>;
 updatePreferences(userId:string,preferences:NotificationEmailPreferences):Promise<NotificationEmailPreferences>;
 click(id:string):Promise<string|null>;
}
let delivery:NotificationDelivery|undefined;
export const setNotificationDelivery=(value:NotificationDelivery|undefined)=>{delivery=value;};
export const notificationDelivery=()=>delivery;
