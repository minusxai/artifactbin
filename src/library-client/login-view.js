import { createEmailChallenge } from "./challenge.ts";
/** @param {import("./view-contracts.ts").LoginViewOptions} options
 * @returns {{open():void}} */
export function mountLogin({ $, request, session, load, frameEvent }) {
  const form = $("login-form"),
    dialog = $("login"),
    button = form.querySelector("[type=submit]");
  let completedClose = false;
  const challenge = createEmailChallenge({
    send: async (email) => {
      await request("/api/auth/email/request", { email });
    },
    verify: session.verify,
    cancel: session.cancelAuthentication,
    async verified() {
      completedClose = true;
      dialog.close();
      await load();
      frameEvent("profile-changed");
    },
    changed(state) {
      const sent = state.phase === "code";
      form.email.readOnly = sent || state.busy;
      form.code.required = sent;
      $("code-field").hidden = !sent;
      $("change-email").hidden = !sent;
      $("resend").hidden = !sent;
      $("resend").disabled = state.busy;
      button.disabled = state.busy;
      button.textContent = sent ? "Sign in" : "Send code";
      form.querySelector("[role=alert]").textContent = state.message;
      if (!sent) form.code.value = "";
      if (!state.busy) (sent ? form.code : form.email).focus();
    },
  });
  function login() {
    form.reset();
    challenge.reset();
    dialog.showModal();
    form.email.focus();
  }
  $("sign-in").onclick = login;
  $("welcome-sign-in").onclick = login;
  dialog.querySelector(".close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    if (completedClose) completedClose = false;
    else challenge.reset();
  });
  $("change-email").onclick = () => challenge.reset();
  $("resend").onclick = () => {
    form.code.value = "";
    return challenge.resend(form.email.value);
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    return challenge.submit(form.email.value, form.code.value);
  };
  return { open: login };
}
