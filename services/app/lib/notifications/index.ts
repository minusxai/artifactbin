/** The notifications module's interface: only what other modules import. */
export { notificationArtifactAuthority, notificationAuthority, notificationExecutionFence, notificationExecutionSource, notificationSourceSchema, notificationSourcesReadable } from './authority';
export { notificationContextSnapshot, notificationRuleSourceIds } from './context';
export { notificationDelivery, setNotificationDelivery } from './delivery';
export type { NotificationDelivery } from './delivery';
export { recordEvent } from './events';
export { notificationJobHttp } from './job-http';
export { createNotificationJobStore } from './jobs';
export type { NotificationJobAuthority } from './jobs';
export { hasExplicitNotificationMembership } from './membership';
export { evaluateNotificationQuery, normalizeNotificationResult } from './query';
export type { NotificationQueryDependencies } from './query';
export { notificationRecipients } from './run-plan';
export { notificationJobStore } from './runtime';
export { createNotificationWorker } from './worker';
export { notificationChannel, recordNotification } from './write';
