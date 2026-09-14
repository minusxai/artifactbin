# Saved agent submissions

These are saved outputs from local pi 0.77 calling the hosted Fireworks model
`accounts/fireworks/models/deepseek-v4-flash-0731` during the approved planning
trials. They contain no provider credentials or transcripts.

`widget.js` is the first submission from `errors/iframe-full-1`; the prototype
accepted it on all eleven widget checks. `open.js` and `mutate.js` are the two
scripts from `isolated/session-mutate-1`; that trial completed without script
errors. Files retain the agent's code. The browser gate substitutes only the
fixture artifact ID and runtime page ID in the two session scripts.

Replaying them against the shipped API tests transfer from prototype to product.
It is deterministic regression evidence, not a fresh agent trial or a held-out
reliability estimate. The broader planning study used 59 live trials and iterated
its contract and teaching; its results must not be described as 59 independent
successful first attempts. The pinned model is text-only.
