/** Offline patch of one audited, pinned archived port. No authored source is transformed. */
export function forwardArchivedMembersContext(source: string): string {
  const marker =
    "...(ctx.localTables ? { localTables: ctx.localTables } : {}),";
  if (
    source.split(marker).length !== 2 ||
    !source.includes("evaluateDataflow({")
  )
    throw Error("Archived member context port changed");
  return source.replace(
    marker,
    marker + "\n      ...(ctx.members ? { members: ctx.members } : {}),",
  );
}
