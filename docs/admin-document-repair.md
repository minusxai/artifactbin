# Administrative document access

Set `ADMIN__EMAILS=operator@example.com,second@example.com` on the app service.
Verified accounts on that list can open and edit any live markup document through
the normal document UI and ordinary `afbin pull` / `afbin push` commands. No
client configuration, admin panel, special commands, or separate repair API is
required. The default is empty (disabled).

Configure the setting on the intended deployment and restart/redeploy the app.
Every permission check consults the current process allowlist. Removing an email
ends its additional access on subsequent requests.

The proxy resolves browser sessions and looks up the current account email and
verification status for each claimed bearer token. The app accepts token claims
only when both token ID and account ID match the authenticated scope. Custom
proxy compositions must provide `SessionStore.identity` for token-based email
grants; without it, tokens retain ordinary permissions. Both standard deployment
shapes supply this lookup. No token replacement or CLI update is required.

Anonymous tokens, agent cookies, client-supplied emails, and document automation
do not acquire admin access. Token revocation and ordinary cross-site write
protection still apply.

Admins receive editor permission, preserving the document's owner. Dataset
permissions and owner-only operations retain their existing checks. Saves use
the standard validation, conflict protection, and version history, attributed
to the actual editor and token. There is no separate administrative audit table.
