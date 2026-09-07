/** V0 remote-terminal protocol. PTY bytes stay on the user's machine until explicitly shared. */
export interface RemoteSessionInfo {
  id: string;
  name: string;
  harness: string;
  cwd: string;
  machine: string;
  cols: number;
  rows: number;
  online: boolean;
  exitCode: number | null;
  controller: "local" | "web";
  createdAt: string;
}
export interface RemoteInput {
  id: number;
  kind: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
  source?: "keyboard" | "comment";
}
export interface RemoteExchange {
  runnerKey: string;
  outputSeq: number;
  output: string;
  ack: number;
  cols: number;
  rows: number;
  exitCode?: number;
  localControl?: boolean;
}
export interface RemoteExchangeResult {
  inputs: RemoteInput[];
  controller: "local" | "web";
}
export interface RemoteFrame {
  seq: number;
  data: string;
  cols: number;
  rows: number;
}
export interface RemoteView {
  session: RemoteSessionInfo;
  seq: number;
  frames: RemoteFrame[];
  snapshot?: string;
}
