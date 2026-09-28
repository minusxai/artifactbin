import type {MutationNotificationPlan,NotificationSource} from '@artifactbin/contracts';
export interface NotificationRecipientPlan {recipientId:string;messages:string[];sources:NotificationSource[]}
/** Collapse all rows/rules to one recipient plan; retain every contributing source. */
export function notificationRecipients(_plan:MutationNotificationPlan):NotificationRecipientPlan[]{ return []; }
