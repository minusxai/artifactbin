import type {RunStart} from './runner';
/** Hosted native processes use one fixed PTY geometry, independent of viewer width. */
export const HOSTED_TERMINAL_SIZE={cols:100,rows:30} as const;
export const HOSTED_HARNESSES=['claude','codex','pi','opencode'] as const;
/** V0 remote-terminal protocol. PTY bytes stay on the user's machine until explicitly shared. */
export interface RemoteSessionInfo {
  /** Assigned by the app for the account’s included hosted agent, never inferred from its name. */
  included?: boolean;
  /** App-owned managed Run mapping; never an authorization grant. */
  runId?: string;
  /** Native harness connected to the shared comment relay. Non-secret generation fence. */
  hostedGeneration?:string;
  hostedWakeAttempts?:number;
  hostedConfig?:{command:string[];compute:Required<Pick<NonNullable<RunStart['compute']>,'vcpu'|'memoryMiB'|'ttlSeconds'>>&Pick<NonNullable<RunStart['compute']>,'idleSeconds'>;sshPublicKey?:string};
  /** Non-secret configuration fingerprint used for named-box admission. */
  managedConfigHash?: string;
  sshCommand?: string;
  sshHostKey?: string;
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
  managed?: boolean;
  color?: RemoteColor;
  activity?: RemoteActivity;
}
export interface RemoteInput {
  id: number;
  kind: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
  source?: "keyboard" | "comment";
  requestId?: string;
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
  activity?: RemoteActivity;
}
export interface RemoteExchangeResult {
  stop?: boolean;
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
  /** Changes whenever the relay rebuilds this session. */
  generation?: string;
  session: RemoteSessionInfo;
  seq: number;
  frames: RemoteFrame[];
  snapshot?: string;
}

/** Managed agents keep a stable identity independently of terminal connectivity. */
export const REMOTE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const REMOTE_HISTORY_BYTES = 128 * 1024;
export const REMOTE_WORK_LIMIT = 100;
export const REMOTE_WORK_BYTES = 128 * 1024;
export const REMOTE_COLORS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
export type RemoteColor = typeof REMOTE_COLORS[number];
export type RemoteActivity = 'queued' | 'starting' | 'listening' | 'working' | 'blocked' | 'unknown' | 'stopping' | 'stopped';
export type RemoteWorkPhase = 'queued' | 'dispatching' | 'superseded' | 'delivered' | 'acknowledged' | 'completed' | 'cancelled' | 'failed' | 'blocked' | 'uncertain' | 'unavailable';
export interface RemoteWork {
 id:string; sessionId:string; artifactId:string; threadId:string; commentId:string;
 name:string; color:RemoteColor; phase:RemoteWorkPhase; updatedAt:string;
 reason?:'queue_full'|'unauthorized'|'interrupted';
 activity?:RemoteActivity;connection?:'online'|'offline'|'stopped';
}

/** Stable across reloads and usable by mention renderers without private session lookups. */
export function remoteColor(id:string):RemoteColor {let value=0;for(const char of id)value=(value*31+char.charCodeAt(0))>>>0;return REMOTE_COLORS[value%REMOTE_COLORS.length]!;}
export const REMOTE_COLOR_CSS:Record<RemoteColor,string>={blue:'light-dark(#1d4ed8, #93c5fd)',violet:'light-dark(#6d28d9, #c4b5fd)',teal:'light-dark(#0f766e, #5eead4)',amber:'light-dark(#92400e, #fcd34d)',rose:'light-dark(#be185d, #f9a8d4)',slate:'light-dark(#475569, #cbd5e1)'};
