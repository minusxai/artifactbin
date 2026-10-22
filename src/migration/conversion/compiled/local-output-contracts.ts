import type { ArchivedLocalOutput } from "./local-contracts.ts";
import type { AdmittedLocalSource } from "./source-admission-contracts.ts";
/** Validated self-contained compiler output, reconciled with source-owned state
 * and capability declarations. Only this value may reach page assembly. */
export interface AdmittedLocalOutput {
  readonly output: ArchivedLocalOutput;
  readonly body: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly identities: Readonly<Record<string, string>>;
}
export type LocalOutputAdmission =
  | { readonly ok: true; readonly value: AdmittedLocalOutput }
  | { readonly ok: false; readonly code: string };
export type AdmitLocalOutput = (
  plan: AdmittedLocalSource,
  output: unknown,
) => LocalOutputAdmission;
