import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { TestRequirements } from "./contracts.ts";

/**
 * Test stages whose selected files declare no backend image (every stage but
 * isolate) run with a `docker` ahead of the real CLI on PATH that refuses the
 * product's container images by name and hands every other command through.
 * CI never builds these images for such a stage, so a browser, database,
 * local or unit test that starts a sandbox there fails in CI; this makes it
 * fail the same way on a developer machine that happens to have the images,
 * with the staging rule in the error instead of a missing-image message.
 */
export const GUARD_EXIT_CODE = 125;
/** Where the guard records each refusal; the runner prints it after the stage so the rule is visible even when a host swallows docker's stderr. */
export const REPORT_VARIABLE = "PAGEGI_DOCKER_GUARD_REPORT";

/** The tags the container code resolves with `docker image inspect` before creating any container. */
export function refusedImages(env: NodeJS.ProcessEnv): string[] {
  return [
    env.PAGEGI_BACKEND_IMAGE ?? "pagegi-backend:local",
    "pagegi-dataset-sql:local",
    "pagegi-image-processor:local",
  ];
}

export function guardMessage(tag: string): string {
  return (
    `docker refused ${tag}: this test stage declares no backend image. ` +
    "A test that runs a sandbox, dataset SQL or image-processing container is staged .isolate " +
    "(scripts/testing/inventory.ts); no other stage builds or pulls these images, locally or in CI."
  );
}

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** A POSIX sh `docker` that refuses the listed images and otherwise runs the real CLI. */
export function guardScript(
  refused: readonly string[],
  realDocker: string | undefined,
): string {
  const cases = refused
    .map((tag) => `    ${quote(tag)}) refuse ${quote(guardMessage(tag))} ;;`)
    .join("\n");
  const passthrough = realDocker
    ? `exec ${quote(realDocker)} "$@"`
    : 'echo "docker is not installed" >&2; exit 127';
  // The container code captures docker's stderr, so the refusal is also appended to the stage's report.
  const refuse =
    'refuse() {\n  printf "%s\\n" "$1" >&2\n  if [ -n "${' +
    REPORT_VARIABLE +
    ':-}" ]; then printf "%s\\n" "$1" >> "$' +
    REPORT_VARIABLE +
    `"; fi\n  exit ${GUARD_EXIT_CODE}\n}`;
  return `#!/bin/sh\n${refuse}\nfor arg in "$@"; do\n  case "$arg" in\n${cases}\n  esac\ndone\n${passthrough}\n`;
}

export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const file = join(directory, name);
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // not here
    }
  }
  return undefined;
}

/** The environment the selected tests run in: untouched when they declare the backend image. */
export function guardedEnvironment(
  needs: Pick<TestRequirements, "backend">,
  env: NodeJS.ProcessEnv,
  directory: () => string = () =>
    mkdtempSync(join(tmpdir(), "pagegi-docker-guard-")),
): NodeJS.ProcessEnv {
  if (needs.backend) return env;
  const guard = directory();
  writeFileSync(
    join(guard, "docker"),
    guardScript(refusedImages(env), findExecutable("docker", env)),
    { mode: 0o755 },
  );
  return {
    ...env,
    PATH: guard + delimiter + (env.PATH ?? ""),
    [REPORT_VARIABLE]: join(guard, "refusals.log"),
  };
}

/** The refusals a guarded run recorded, one message per line; empty when none or when the stage ran unguarded. */
export function guardReport(env: NodeJS.ProcessEnv): string {
  const file = env[REPORT_VARIABLE];
  if (!file) return "";
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
