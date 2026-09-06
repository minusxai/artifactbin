import { remoteRoute } from '@/lib/remote/route';
export const GET = (request: Request) => remoteRoute(request);
export const POST = (request: Request) => remoteRoute(request);
