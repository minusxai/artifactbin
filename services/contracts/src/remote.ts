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
export const REMOTE_COLORS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
export type RemoteColor = typeof REMOTE_COLORS[number];
export type RemoteActivity = 'starting' | 'listening' | 'working' | 'blocked' | 'unknown' | 'stopping' | 'stopped';
export type RemoteWorkPhase = 'queued' | 'dispatching' | 'superseded' | 'delivered' | 'acknowledged' | 'completed' | 'blocked' | 'uncertain' | 'unavailable';
export interface RemoteWork {
 id:string; sessionId:string; artifactId:string; threadId:string; commentId:string;
 name:string; color:RemoteColor; phase:RemoteWorkPhase; updatedAt:string;
 activity?:RemoteActivity;connection?:'online'|'offline'|'stopped';
}

/** Stable across reloads and usable by mention renderers without private session lookups. */
export function remoteColor(id:string):RemoteColor {let value=0;for(const char of id)value=(value*31+char.charCodeAt(0))>>>0;return REMOTE_COLORS[value%REMOTE_COLORS.length]!;}
export const REMOTE_COLOR_CSS:Record<RemoteColor,string>={blue:'#518bda',violet:'#a07ce3',teal:'#36a695',amber:'#c68a28',rose:'#d67396',slate:'#8894aa'};
