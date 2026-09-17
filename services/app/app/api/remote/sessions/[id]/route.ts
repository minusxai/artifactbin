import { remoteRoute } from '@/lib/remote/route';
const route = async (request: Request, ctx: {params: Promise<{id: string}>}) => remoteRoute(request, (await ctx.params).id);
export const GET = route;
export const POST = route;
export const DELETE = route;
