/** Application assembly: both handlers and the worker use the same authority-bound store. */
import type {MutationNotificationJobStore} from '@artifactbin/contracts';
import {getDb} from '../platform/db';
import {createNotificationJobStore} from './jobs';
import {notificationAuthority} from './authority';

export async function notificationJobStore():Promise<MutationNotificationJobStore>{
 return createNotificationJobStore({db:await getDb(),authority:notificationAuthority});
}
