# External hosted-agent service

OSS does not allocate default agents. An operator may configure `HOSTED_AGENT__SERVICE_URL`, `CONTRACT__ACTOR_SECRET`, and `APP__PUBLIC_BASE_URL` to connect a separate agent service. The service must implement the exported `HostedRemoteAgent` contract. App and service storage are independent.

There are three purpose-specific actor signatures, with signed account identity:

- Ordinary terminal/chat requests use `CONTRACT__ACTOR_SECRET` in `x-artifactbin-hosted-actor` (direct-service clients may use `x-mx-actor`).
- Trusted comment delivery uses `hostedAgentDeliveryKey(secret)` in `x-artifactbin-hosted-delivery`; a browser/proxy signature must be rejected here.
- Service callbacks use `hostedAgentCallbackKey(secret)` in `x-artifactbin-hosted-callback`; ordinary browser/proxy signatures must be rejected here.

Dedicated hosted headers survive ordinary identity proxies rewriting `x-mx-actor`. The app utilities provide `hostedAgentTransport` and `hostedAgentDeliveryTransport` for these headers.

The two derived keys use HMAC-SHA256 over the literal strings `artifactbin/hosted-agent-delivery/v1` and `artifactbin/hosted-agent-callback/v1`, respectively, and return hexadecimal strings. Never expose either key, actor signature, or app-internal remote proof in public session info.

`POST /v1/agents/comment` accepts this JSON directly, without a wrapper:

```json
{"requestId":"stable-app-work-id","sessionId":"sha256(hosted:account-id)","artifactId":"document-id","threadId":"annotation-id","commentId":"human-comment-id","body":"Please check this","author":"Alice","callbackUrl":"https://app.example.com/api/remote/hosted/operations"}
```

The delivery's owner comes from the signed actor, never the body. Accept only the configured app callback origin/path. Persist acceptance before responding successfully, and deduplicate by owner plus `requestId`. A lost response will cause the app to redeliver that same ID. The app commits comment admission and its outbox record together, leases delivery outside the annotation transaction, and retries ambiguous delivery. Undelivered work survives app restart. An unreachable service leaves the work pending; it does not lose the saved comment.

The service posts operations to the supplied callback:

```json
{"requestId":"stable-app-work-id","sessionId":"sha256(hosted:account-id)","operation":"read","input":{}}
```

```json
{"requestId":"stable-app-work-id","sessionId":"sha256(hosted:account-id)","operation":"reply","input":{"body":"Working on it","phase":"acknowledged"}}
```

Reply phases are `acknowledged`, `completed`, or `blocked`. `resolve: true` is optional on a completed reply. The app binds owner, session, artifact, and thread from its stored work; supplied target IDs cannot expand access. It rechecks current artifact permission, retains existing receipt-transition checks, and refuses resolving over later human comments. Retries of the same phase and body use the existing mutation receipt keyed by work ID plus phase. A changed body under the same key is a conflicting retry. Bodies are capped at 64 KiB and reply text at 32,000 characters.

The service need not share the app database or know any local-agent credential. It retains conversation/execution state itself and uses the callback only for the authorized comment's reads and replies. The deployment-owned in-process factory continues using its existing shared-database adapter.
