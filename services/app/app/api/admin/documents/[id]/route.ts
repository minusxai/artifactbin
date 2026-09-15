import {adminDocuments} from '@/lib/admin-documents';
type Context = {params: Promise<{id: string}>};
export const GET = async (request: Request, {params}: Context) => adminDocuments(request, (await params).id);
export const PUT = GET;
