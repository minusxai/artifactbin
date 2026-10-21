/** Account frames exchange lifecycle and nonsecret theme events; credentials never cross this boundary. */
export type AccountFrameMessage =
  | {
      type: "pagegi-account";
      event: "ready" | "profile-changed" | "close";
    }
  | {
      type: "pagegi-account";
      event: "theme-changed";
      theme: "light" | "dark";
    };
export interface AccountModal {
  close(): void;
}
export type OpenAccount = (
  origin: string,
  onChanged?: () => void | Promise<void>,
) => AccountModal;
