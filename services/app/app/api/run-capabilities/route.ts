import {managedRunRoute} from '@/lib/remote/managed-runs';
export const GET=(request:Request)=>managedRunRoute(request,'capabilities');
