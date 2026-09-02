/** Schema as data → idempotent, additive DDL. Each package declares its own tables with these; utils renders them. */
export interface Column { name: string; type: string; notNull?: boolean; default?: string; retired?: boolean }
export interface Index { name: string; columns: string[]; unique?: boolean; where?: string }
export interface Table { name: string; columns: Column[]; primaryKey: string[]; uniques?: string[][]; indexes?: Index[] }
