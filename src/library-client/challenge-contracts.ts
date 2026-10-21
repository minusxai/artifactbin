export interface EmailChallengeState {
  phase: "email" | "code";
  busy: boolean;
  message: string;
}
export interface EmailChallengeOptions {
  send(email: string): Promise<void>;
  verify(email: string, code: string): Promise<boolean>;
  cancel(): void;
  changed(state: EmailChallengeState): void;
  verified(): void | Promise<void>;
}
/** A reset invalidates both UI completion and credential installation from an old attempt. */
export interface EmailChallenge {
  reset(): void;
  submit(email: string, code: string): Promise<void>;
  resend(email: string): Promise<void>;
}
