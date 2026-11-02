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
