import type {RunnerJson, RunStart, RunSnapshot} from './runner';
/** Schedules reference live artifacts. Execution material is resolved only when an attempt starts. */
export interface ScheduleInput {
  userId: string; artifactId: string; cron: string; timezone: string;
  input: RunnerJson; maxAttempts?: number; retryBackoffSeconds?: number;
}
export interface ScheduleRecord {
  id: string; owner: string; artifactId: string; cron: string; timezone: string;
  input: RunnerJson; enabled: boolean; nextDueAt: string;
  maxAttempts: number; retryBackoffSeconds: number;
}
export interface ScheduleAttempt {
  id: string; occurrenceId: string; attemptNumber: number; requestId: string;
  runId: string | null; status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
  nextAttemptAt: string; error: string | null; result: RunSnapshot | null;
}
export interface ScheduleOccurrence {
  id: string; scheduleId: string; scheduledFor: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  attempts: ScheduleAttempt[];
}
export type ScheduledExecution = Omit<RunStart, 'requestId' | 'userId' | 'input'>;
export type ScheduleResolver = (spec: ScheduleInput) => Promise<ScheduledExecution>;
export interface SchedulerService {
  put(spec: ScheduleInput, now?: Date): Promise<ScheduleRecord>;
  list(userId: string): Promise<ScheduleRecord[]>;
  get(userId: string, id: string): Promise<ScheduleRecord>;
  update(userId: string, id: string, patch: Partial<Omit<ScheduleInput,'userId'|'artifactId'>> & {enabled?: boolean}, now?: Date): Promise<ScheduleRecord>;
  remove(userId: string, id: string): Promise<void>;
  runNow(userId: string, id: string, requestId: string, now?: Date): Promise<{occurrenceId: string}>;
  history(userId: string, id: string): Promise<ScheduleOccurrence[]>;
  tick(now?: Date): Promise<void>;
}
