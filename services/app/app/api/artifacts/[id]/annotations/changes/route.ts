import {withTokenAuth} from '@/lib/accounts';
/** Seed boundary: the annotation module owns cursor, permission and wait semantics. */
export const GET=withTokenAuth(async()=>Response.json({error:'not_implemented'},{status:501}));
