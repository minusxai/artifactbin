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
  if (options.managed && (harness === "codex" || harness === "claude") && options.source === "comment" && options.commentCommand) {
    // remoteRequestInput appends the submit key; send the request as one explicit
    // bracketed paste, then submit in its own write. Codex consumes the boundary
    // directly, and Claude's terminal input can truncate large unframed requests.
    // Neither provider needs a timing guess or replay for this managed paste.
    write(PASTE_START);
    write(input.endsWith("\r") ? input.slice(0, -1) : input);
    write(PASTE_END);
    if (options.canWrite?.() !== false) write("\r");
    return;
  }

  // Preserve the established terminal behavior for shells, other providers,
  // unmanaged comments, and keyboard input. Managed Codex and Claude comments
  // have an explicit paste boundary.
  if (input.length > 1 && input.endsWith("\r")) {
    write(input.slice(0, -1));
    await delay(200);
    if (options.canWrite?.() !== false) write("\r");
  } else write(input);
}
