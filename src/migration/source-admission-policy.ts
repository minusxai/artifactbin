import type {
  MigrationSourceAdmission,
  MigrationConversionStrategy,
} from "./conversion-strategy-contracts.ts";
/** The policy changes offline compilation only; it never grants destination or runtime authority. */
export function validateMigrationSourceAdmission(options: {
  conversionStrategy: MigrationConversionStrategy;
  sourceAdmission?: MigrationSourceAdmission;
}): MigrationSourceAdmission {
  const policy = options.sourceAdmission ?? "strict";
  if (policy !== "strict" && policy !== "offline-prototype")
    throw Error("Unknown migration source admission policy");
  if (
    policy === "offline-prototype" &&
    options.conversionStrategy !== "archived-functional"
  )
    throw Error(
      "Offline prototype source admission requires archived-functional conversion",
    );
  return policy;
}
