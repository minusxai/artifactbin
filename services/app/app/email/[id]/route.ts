import {notificationDelivery} from '@/lib/notification-delivery';
/** Opaque tracking IDs never authorize reading or accepting the destination. */
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const destination=await notificationDelivery()?.click(id);
 if(!destination||!destination.startsWith('/')||destination.startsWith('//')||destination.includes('\\'))return new Response('This link is no longer available',{status:404});
 return new Response(null,{status:302,headers:{Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
