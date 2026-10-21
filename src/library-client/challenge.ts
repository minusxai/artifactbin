import type {
  EmailChallenge,
  EmailChallengeOptions,
  EmailChallengeState,
} from "./challenge-contracts.ts";
export function createEmailChallenge(
  options: EmailChallengeOptions,
): EmailChallenge {
  let epoch = 0;
  let state: EmailChallengeState = { phase: "email", busy: false, message: "" };
  const publish = (next: EmailChallengeState) => {
    state = next;
    options.changed({ ...state });
  };
  async function attempt(email: string, code: string, resend: boolean) {
    if (state.busy || (resend && state.phase !== "code")) return;
    const version = epoch,
      phase = state.phase;
    publish({ ...state, busy: true, message: "" });
    try {
      if (phase === "email" || resend) {
        await options.send(email);
        if (version !== epoch) return;
        publish({
          phase: "code",
          busy: true,
          message: resend
            ? "A new code is on its way."
            : "Check your email for a six-digit code. It expires in 10 minutes.",
        });
      } else {
        const verified = await options.verify(email, code);
        if (version !== epoch) return;
        if (verified) await options.verified();
      }
    } catch (error) {
      if (version === epoch)
        publish({
          ...state,
          message: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (version === epoch) publish({ ...state, busy: false });
    }
  }
  return {
    reset() {
      epoch++;
      options.cancel();
      publish({ phase: "email", busy: false, message: "" });
    },
    submit: (email, code) => attempt(email, code, false),
    resend: (email) => attempt(email, "", true),
  };
}
