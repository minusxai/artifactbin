/** A script failure with its exit code (EXIT in ./lifecycle-contracts.ts) and the message to print. */
import type { ExitCode } from "./lifecycle-contracts.ts";

export class Failure extends Error {
  readonly code: ExitCode;
  constructor(code: ExitCode, message: string) {
    super(message);
    this.code = code;
  }
}
