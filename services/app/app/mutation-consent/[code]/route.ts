import {mutationConsentPage} from '@/lib/mutation-consent';
export async function GET(request: Request, ctx: {params: Promise<{code: string}>}) {
  return mutationConsentPage(request, (await ctx.params).code);
}
export const POST = GET;
