/**
 * The notifications module's interface: only what other modules import.
 *
 * Sources (accounts, artifacts, annotations) never import this module: they record facts through
 * lib/platform's recordEvent, and the composition root registers `projectNotifications` as its
 * in-transaction projection. So notifications sits above accounts and artifacts, and decides access
 * with their rules directly.
 */
// Record: facts become recipient rows in the source's transaction.
export { projectNotifications } from './events';
export { notificationChannel, notifyThread, recordNotification } from './write';
// Inbox: what a person reads and changes; optional deployment email delivery.
export { membershipInbox, updateMembershipInbox } from './inbox';
export { notificationDelivery, setNotificationDelivery } from './delivery';
export type { GroupEmail,NotificationDelivery } from './delivery';

export {flushGroupMail,startGroupMailDelivery} from './group-mail';
