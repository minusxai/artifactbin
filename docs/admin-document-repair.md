# Administrative document access

Set `ADMIN__EMAILS=operator@example.com,second@example.com` on the app service.
Verified accounts on that list can open and edit any live markup document through
the normal document UI. No client configuration, admin panel, special commands,
or separate repair API is required. The default is empty (disabled).

Configure the setting on the intended deployment and restart/redeploy the app.
Every permission check consults the current process allowlist. Removing an email
ends its additional access on subsequent requests.

The server uses verified browser-session claims from the proxy. Bearer tokens,
agent cookies, client-supplied emails, and document automation do not acquire
admin access. The ordinary cross-site write protection still applies.

Admins receive editor permission, preserving the document's owner. Dataset
permissions and owner-only operations retain their existing checks. Saves use
the standard validation, conflict protection, and version history, attributed
to the actual editor. There is no separate administrative audit table.
