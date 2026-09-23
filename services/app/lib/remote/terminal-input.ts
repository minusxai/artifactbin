/**
 * xterm onData includes protocol feedback, not only typing/paste. Keep complete
 * reports flowing to the PTY without treating them as a new human task. Match
 * only known reply forms: ordinary keys, pasted text and mixed payloads still
 * invalidate readiness. xterm emits each reply as a complete onData event.
 */
const terminalFeedback = new RegExp(`^(?:${[
  // Cursor/device status, device attributes, mode/window reports, focus changes.
  String.raw`\x1b\[(?:\??\d+;\d+R|0n|[?>][\d;]*c|\??\d+;\d+\$y|\d+(?:;\d+)*t|[IO])`,
  // Palette/default foreground, background and cursor color reports.
  String.raw`\x1b\](?:4;\d+|1[012]);rgb:[a-fA-F\d]{1,4}/[a-fA-F\d]{1,4}/[a-fA-F\d]{1,4}(?:\x07|\x1b\\)`,
  // DECRQSS replies (SGR, margins, cursor style and other terminal settings).
  String.raw`\x1bP[01]\$r[ -~]*\x1b\\`,
].join('|')})+$`);

export function isTerminalFeedback(data: string): boolean {
  return data.length > 0 && terminalFeedback.exec(data)?.[0] === data;
}
