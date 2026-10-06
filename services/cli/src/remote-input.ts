import { setTimeout as delay } from "node:timers/promises";
import { basename } from "node:path";
import { remoteRequestInput } from "./remote-context";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Deliver relay input while preserving the provider's paste and submit boundary. */
export async function deliverRemoteInput(
  write: (data: string) => void,
  data: string,
  options: { source?: "keyboard" | "comment"; command: string; managed?: boolean; commentCommand?: string; canWrite?: () => boolean },
): Promise<void> {
  const harness = basename(options.command).replace(/\.exe$/i, "");
  const input = options.source === "comment" && options.commentCommand
    ? remoteRequestInput(data, options.commentCommand)
    : data;
  if (options.managed && harness === "codex" && options.source === "comment" && options.commentCommand) {
    // remoteRequestInput appends the submit key; send the request as one explicit
    // bracketed paste, then submit in its own write. Codex consumes the boundary
    // directly, so no timing guess or replay is needed.
    write(PASTE_START);
    write(input.endsWith("\r") ? input.slice(0, -1) : input);
    write(PASTE_END);
    if (options.canWrite?.() !== false) write("\r");
    return;
  }

  // Preserve the established terminal behavior for shells, other providers,
  // and keyboard input. Only managed Codex comments have an explicit paste.
  if (input.length > 1 && input.endsWith("\r")) {
    write(input.slice(0, -1));
    await delay(200);
    if (options.canWrite?.() !== false) write("\r");
  } else write(input);
}
