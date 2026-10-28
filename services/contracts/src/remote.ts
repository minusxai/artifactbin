import type {RunStart} from './runner';
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
interface RemoteFrame {
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

const REMOTE_COLORS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
export type RemoteColor = typeof REMOTE_COLORS[number];
export type RemoteActivity = 'queued' | 'starting' | 'listening' | 'working' | 'blocked' | 'unknown' | 'stopping' | 'stopped';
type RemoteWorkPhase = 'queued' | 'dispatching' | 'superseded' | 'delivered' | 'acknowledged' | 'completed' | 'cancelled' | 'failed' | 'blocked' | 'uncertain' | 'unavailable';
export interface RemoteWork {
 id:string; sessionId:string; artifactId:string; threadId:string; commentId:string;
 name:string; color:RemoteColor; phase:RemoteWorkPhase; updatedAt:string;
 reason?:'queue_full'|'unauthorized'|'interrupted';
 activity?:RemoteActivity;connection?:'online'|'offline'|'stopped';
}

/** Stable across reloads and usable by mention renderers without private session lookups. */
export const REMOTE_COLOR_CSS:Record<RemoteColor,string>={blue:'light-dark(#1d4ed8, #93c5fd)',violet:'light-dark(#6d28d9, #c4b5fd)',teal:'light-dark(#0f766e, #5eead4)',amber:'light-dark(#92400e, #fcd34d)',rose:'light-dark(#be185d, #f9a8d4)',slate:'light-dark(#475569, #cbd5e1)'};
