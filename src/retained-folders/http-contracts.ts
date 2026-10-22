import type { RetainedFolderService } from "./contracts.ts";
export interface RetainedFolderResponse {
  status: 200;
  headers: Readonly<Record<string, string>>;
  body: string;
}
/** Returns null for non-folder addresses or unreadable folders, leaving the normal
 * page address handler to give its uniform 404. This port never accepts actor/role claims. */
export type RetainedFolderRoute = (
  method: string,
  url: URL,
  credential?: string,
) => Promise<RetainedFolderResponse | null>;
export type RetainedFolderReader = Pick<RetainedFolderService, "read">;
