import { remoteRoute } from '@/lib/remote/route';
export const POST = async (request: Request, ctx: {params: Promise<{id: string}>}) => remoteRoute(request, (await ctx.params).id, true);
