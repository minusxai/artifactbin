import { fail } from "../errors.ts";
import type { FilePermissions } from "../contracts.ts";
import type {
  PageRevisionSelection,
  SelectedPageRevision,
} from "./page-revision-contracts.ts";
/** A supplied but invalid selector is an error, never an implicit live-head read. */
export function parsePageRevision(
  query: URLSearchParams,
): PageRevisionSelection {
  const values = query.getAll("version");
  if (!values.length) return { kind: "head" };
  const value = values[0]!;
  if (
    values.length !== 1 ||
    !/^[1-9][0-9]*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    fail(400, "Invalid saved page version");
  return { kind: "saved", version: Number(value) };
}
export function resolvePageRevision(
  selection: PageRevisionSelection,
  head: string,
): SelectedPageRevision {
  const version = selection.kind === "saved" ? selection.version : Number(head);
  if (!Number.isSafeInteger(version) || version < 1)
    fail(500, "Stored page version is invalid");
  return { version, historical: selection.kind === "saved" };
}
export function pageRevisionQuery(selection: PageRevisionSelection): string {
  return selection.kind === "saved" ? "?version=" + selection.version : "";
}
export function readOnlyPagePermissions(
  grant: FilePermissions,
): FilePermissions {
  return {
    ...grant,
    edit: false,
    comment: false,
    manage: false,
    authorizationContext: null,
  };
}
