Reuse origin-scoped credentials. `afbin status` reads saved state (last observed, no login); `accounts.credentials.present` reports credential availability, not validity. `accounts.credential` is the last observed identity and can be null with credentials present. `afbin auth status` is not a status command.

CLI chat: ask email, `afbin auth --email <email>`, ask code, `afbin auth --email <email> --otp <code>`. Automatic browser approval only on shared desktop/request. See [auth]([[ references ]]publishing-auth.md); never mint or print tokens.
