/** Candidate Phase 1 contract. Static preview deliberately never executes historical app code. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface HistoricalContext { sourceRevision: string; snapshot: Json; renderedHtml?: string }
export interface ReplayDocument { html: string; revision: string; mode: 'static'; fidelity: 'captured-dom' | 'source-only'; snapshot: Json }
export interface LiveMessage { epoch: number; kind: 'state' | 'presence' | 'comment' | 'edit'; value: Json }
export interface ReplaySession {
  readonly epoch: number;
  readonly mode: 'live' | 'history';
  readonly ownState: Json;
  enter(context: HistoricalContext): ReplayDocument;
  publish(message: LiveMessage): boolean;
  leave(): Json;
}
