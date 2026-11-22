const REMOTE_COLORS = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
export type RemoteColor = typeof REMOTE_COLORS[number];
export type RemoteActivity = 'queued' | 'starting' | 'listening' | 'working' | 'blocked' | 'unknown' | 'stopping' | 'stopped';
