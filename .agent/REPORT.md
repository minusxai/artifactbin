# Native Codex/Claude terminal submission

The managed terminal adapter now treats a complete line ending in CR as one bracketed paste for Codex and Claude, regardless of whether it came from the terminal relay keyboard source or an artifact comment. It writes the exact payload without CR, writes the paste-end marker, waits 200 ms, and then writes one separate CR if the PTY remains writable. Incomplete/raw keyboard chunks and unmanaged/provider-shell input keep their existing behavior. Comment payload transformation still occurs before framing.

The selected CLI runner test file passed 19/19 tests, including large keyboard/comment paste framing, one submit after the settle gap, suppression when the PTY exits during settling, duplicate relay delivery, and raw text/CR/Escape chunks. `npm run validate` passed. An exact built native Codex paste proof remains pending; the observed manual UI failure needs that confirmation before claiming end-to-end resolution.
