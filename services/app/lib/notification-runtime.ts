/** Application assembly: both handlers and the worker use the same authority-bound store. */
import type {MutationNotificationJobStore} from '@artifactbin/contracts';
import {getDb} from './db';
import {createNotificationJobStore} from './notification-jobs';
import {notificationAuthority} from './notification-query';

export async function notificationJobStore():Promise<MutationNotificationJobStore>{
 return createNotificationJobStore({db:await getDb(),authority:notificationAuthority});
}
