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
export { hasExplicitNotificationMembership } from './membership';
export { notificationRecipients } from './run-plan';
// Inbox: what a person reads and changes; optional deployment email delivery.
export { membershipInbox, updateMembershipInbox } from './inbox';
export { notificationDelivery, setNotificationDelivery } from './delivery';
export type { NotificationDelivery } from './delivery';
// Jobs: durable mutation-notification jobs, their worker and the authority they run under.
export { notificationContextSnapshot, notificationQueryContext, notificationRuleSourceIds } from './context';
export { NotificationExecutionError } from './errors';
export { createNotificationJobStore } from './jobs';
export type { NotificationJobAuthority } from './jobs';
export { notificationJobStore } from './runtime';
export { createNotificationWorker } from './worker';
export { lockNotificationExecution, notificationArtifactAuthority, notificationAuthority, notificationExecutionFence, notificationExecutionSource, notificationPrincipal } from './authority';
export { eraseMutationNotifications, lockMutationNotificationAuthority } from './mutation-notifications';
