// The relay's native terminal answers protocol queries. The browser renders its
// output and snapshots, which can generate the same answers again. Those answers
// are not keystrokes and must not become remote input or invalidate readiness.
const protocolReply = /^(?:\x1b\[(?:[?>]?[0-9;]*c|\??[0-9]+;[0-9]+R|[0-9;]+[nt])|\x1b\](?:4;[0-9]+;|1[012];)rgb:[0-9a-f/]+(?:\x07|\x1b\\))+$/i;

export function isTerminalProtocolReply(value: string): boolean {
  return protocolReply.test(value);
}
