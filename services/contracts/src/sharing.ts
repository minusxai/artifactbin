export const SHARE_ROLES = ['viewer','commenter','editor'] as const;
export type ShareRole = typeof SHARE_ROLES[number];
export interface ShareEntry {email:string;role:ShareRole}
