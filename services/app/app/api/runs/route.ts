import {managedRunRoute} from '@/lib/remote/managed-runs';
export const POST=(request:Request)=>managedRunRoute(request,'create');
