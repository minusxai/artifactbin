/**
 * Pure setup planning: the questions, CLI contract, validation, and rendered
 * environment file. The runner owns every side effect.
 *
 * The example is snapshotted because the runtime image deliberately contains
 * only the setup modules; decoding this constant is deterministic and
 * keeps this module free of filesystem I/O. The snapshot is GENERATED —
 * `npm run generate:env-snapshot` writes it from `.env.example`, and
 * `scripts/__tests__/setup-plan.test.mjs` fails when the two have drifted.
 */

// The app on the development pages host's site (`*.lvh.me` is loopback in public DNS): documents frame on <hex>.lvh.me.
const DEFAULT_PUBLIC_URL = 'http://app.lvh.me:3030';

// Generated from .env.example — do not hand-edit; run `npm run generate:env-snapshot`.
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAocmVzb2x2ZXIgZGF0YWJhc2VzLCBjYXBzLmZldGNoLCB3ZWJob29rcykuCiMgQ29tbWEtc2VwYXJhdGVkIElQdjQgb3IgSVB2Njsgc2VydmVkIGF0IEdFVCAvYXBpL291dGJvdW5kLWlwcyBhbmQgc2hvd24gaW4gdGhlIFJlc29sdmVycyBwYW5lbCBzbyBvd25lcnMKIyBrbm93IHdoYXQgdG8gYWxsb3cgaW4gYSBkYXRhYmFzZSBmaXJld2FsbC4gVW5zZXQgc2VydmVzIGFuIGVtcHR5IGxpc3Q7IGEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19PVVRCT1VORF9JUFM9MjAzLjAuMTEzLjEwCiMgUkVRVUlSRUQuIEV2ZXJ5IGRvY3VtZW50IGlzIHNlcnZlZCBvbiBpdHMgb3duIG9yaWdpbiwgPGhleCBpZD4uPHRoaXMgaG9zdD4sIGZyYW1lZCBieSB0aGUgYXBwIHBhZ2UuCiMgQSBiYXJlIGhvc3RuYW1lOyBzY2hlbWUgYW5kIHBvcnQgZm9sbG93IEFQUF9fUFVCTElDX0JBU0VfVVJMLiBVbnNldCByZWZ1c2VzIHRoZSBib290LiBPdmVyIGh0dHBzIGl0IG1heSBiZQojIGEgcmVnaXN0cmFibGUgZG9tYWluIG9mIGl0cyBvd24gKHJlY29tbWVuZGVkIGluIHByb2R1Y3Rpb247IHRoZSBmcmFtZSdzIGNvb2tpZSBpcyBTYW1lU2l0ZT1Ob25lOyBQYXJ0aXRpb25lZCksCiMgd2l0aCB3aWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgKi48aG9zdD4uIE92ZXIgcGxhaW4gaHR0cCB0aGUgYXBwIG11c3QgYmUgb24gdGhlIHNhbWUgc2l0ZSAoU2FtZVNpdGU9TGF4KS4KIyBEZXZlbG9wbWVudDogbHZoLm1lLCBicm93c2luZyB0aGUgYXBwIGF0IGh0dHA6Ly9hcHAubHZoLm1lOjxwb3J0PiAobnBtIHJ1biBzZXR1cCB3cml0ZXMgYm90aCkuCkFQUF9fUEFHRVNfSE9TVD1sdmgubWUKQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYXNzZXRzIHBlciBhY2NvdW50ICh1cGxvYWRzICsgVVJMcyBpbXBvcnRlZCBmaXJzdCksIDEwIEdCOyBhbm9ueW1vdXMgdG9rZW5zIGhhdmUgdGhlaXIgb3duIGNhcC4gMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49MTAwMDAwMDAwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgojIEVNQUlMX19ERVZfT1VUQk9YX1BBVEg9CiMgUHVibGljIGVtYWlsLWNvZGUgbG9naW4gdXNlcyBlaXRoZXIgU01UUCBvciBSZXNlbmQgd2l0aCBhbiBhdXRob3JpemVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQojIFNNVFAgYWx0ZXJuYXRpdmU6IGRlZmF1bHQgcG9ydCA1ODcgcmVxdWlyZXMgU1RBUlRUTFM7IHNlY3VyZT10cnVlIHVzZXMgaW1wbGljaXQgVExTIChkZWZhdWx0IDQ2NSkuCkVNQUlMX19TTVRQX0hPU1Q9CkVNQUlMX19TTVRQX1BPUlQ9CkVNQUlMX19TTVRQX1NFQ1VSRT0KRU1BSUxfX1NNVFBfVVNFUj0KRU1BSUxfX1NNVFBfUEFTU1dPUkQ9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAwClBERl9fTUFYX0JZVEVTPTUwMDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgTnVtYmVyIG9mIHRydXN0ZWQgZm9yd2FyZGluZyBob3BzIHVzZWQgdG8gaW50ZXJwcmV0IGNsaWVudCBhZGRyZXNzZXMuCkhUVFBfX1RSVVNURURfUFJPWFlfSE9QUz0xCgojIE9wdGlvbmFsIGRlcGxveW1lbnQgY29udHJvbHMuCiMgQVJUSUZBQ1RTX19BTExPV19QVUJMSUM9MQojIERldmVsb3BtZW50IGFuZCB0ZXN0IG9ubHk6IGxldCBwYWdlIGZ1bmN0aW9ucyBiZSBzY2hlZHVsZWQgbW9yZSBvZnRlbiB0aGFuIGV2ZXJ5IDE1IG1pbnV0ZXMgKHdob2xlIG1pbnV0ZXMpLgojIFNDSEVEVUxFU19fTUlOX0lOVEVSVkFMX01JTlVURVM9MQojIEFub255bW91cyB1c2VyL2dyb3VwIHB1Ymxpc2hpbmcgaG9zdHMuIE9mZiBieSBkZWZhdWx0OyBhIGJhcmUgaG9zdG5hbWUuIEVhY2ggbGl2ZSB1c2VyIG9yIGdyb3VwIGhhbmRsZQojICh1bmRlcnNjb3JlcyBiZWNvbWUgaHlwaGVucykgZ2V0cyA8aGFuZGxlPi48dGhpcyBob3N0PjogcHVibGljIEhUTUwgb24gaXRzIGhvbWUsIHVubGlzdGVkIGJ5IElEIG9ubHkgKG5vaW5kZXgsCiMgbm8tcmVmZXJyZXIpLiBFdmVyeSByZXF1ZXN0IHRoZXJlIGlzIGEgZ3Vlc3QncywgY29va2llcyBvciBub3Q6IHNxbCByZWFkcyBhbmQgR0VUIGZ1bmN0aW9ucyBvbmx5LgojIFdpbGRjYXJkIEROUyBhbmQgVExTIGZvciBpdCBhcmUgdGhlIG9wZXJhdG9yJ3M7IHRoZSBwcm9kdWN0IG5ldmVyIHByb3Zpc2lvbnMgYSBob3N0bmFtZS4KIyBBUFBfX1VTRVJfUEFHRVNfSE9TVD11LmV4YW1wbGUuY29tCiMgQSBjdXN0b20gc2hlbGw6IG9uZSBIVE1MIGZpbGUgdGhpcyBwcm9jZXNzIGNhbiByZWFkLCBzZXJ2ZWQgKG5vLXN0b3JlLCB0aGUgYXBwJ3MgQ1NQKSBpbiBwbGFjZSBvZiB0aGUgYXBwJ3Mgb3duCiMgc2NyZWVucyBhdCAvIGFuZCBldmVyeSBhZGRyZXNzIHRoZSBhcHAgZG9lcyBub3Qgb3RoZXJ3aXNlIHNlcnZlLCBzbyBpdCBjYW4gcm91dGUgY2xpZW50LXNpZGUuIFRoZSBBUEksIGFzc2V0cywKIyBzaWduLWluICgvbG9naW4sIC93ZWxjb21lKSwgT0F1dGggYW5kIGRvY3VtZW50IGFkZHJlc3NlcyAoL2EvLi4uLCAvQGhhbmRsZS4uLikgc3RheSB0aGUgYXBwJ3M7IHRoZSBhcHAncyBvdGhlcgojIHNjcmVlbnMgYXJlIG5vdCByZWFjaGFibGUuIEVhY2ggX19DU1BfTk9OQ0VfXyBpbiB0aGUgZmlsZSBiZWNvbWVzIGEgcGVyLXJlc3BvbnNlIHNjcmlwdCBub25jZS4gVW5yZWFkYWJsZTogbm8gYm9vdC4KIyBBUFBfX1NIRUxMX0ZJTEU9L2V0Yy9hcnRpZmFjdGJpbi9zaGVsbC5odG1sCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNlcnZpY2VzIHRoYXQgYWNjZXB0IHRoaXMgaW5zdGFsbGF0aW9uJ3MgaWRlbnRpdHkgdG9rZW5zIChhbiBpZGVudGl0eS1zaWRlIHNldHRpbmc7IGVtcHR5IGJ5IGRlZmF1bHQpOiBlYWNoCiMgYW4gaWQsIHRoZSBvcmlnaW4gaXRzIHRva2VucyBhcmUgYm91bmQgdG8sIGFuZCBvcHRpb25hbGx5IHRoZSBTSEEtMjU2IChoZXgpIG9mIHRoZSBzZWNyZXQgaXQgaW50cm9zcGVjdHMgd2l0aAojIChQT1NUIC9hcGkvaW50ZXJuYWwvaWRlbnRpdHkvaW50cm9zcGVjdCwgYW5zd2VyaW5nIGl0IG9ubHkgZm9yIHRva2VucyBvZiBpdHMgb3duIGF1ZGllbmNlKS4gQSBwZXJzb24gc2lnbnMgaW4KIyBmb3Igb25lIHdpdGggYGF1dGgubWpzIGxvZ2luIC4uLiAtLWF1ZGllbmNlIElEYCAob3IgT0F1dGggd2l0aCByZXNvdXJjZT08b3JpZ2luPik7IGEgdG9rZW4gZm9yIGl0IGlzIG5ldmVyCiMgYWNjZXB0ZWQgYnkgdGhpcyBzZXJ2ZXIncyBBUEkuIEEgY2FsbGVyIGFscmVhZHkgaG9sZGluZyBhIGNyZWRlbnRpYWwgaGVyZSwgYSBzaWduZWQtaW4gcGFnZSAoc2FtZSBPcmlnaW4pIG9yIGFuCiMgb3JkaW5hcnkgQVBJIGJlYXJlciwgZXhjaGFuZ2VzIGl0IGZvciBhIDUtbWludXRlIHRva2VuIGZvciB0aGF0IHNlcnZpY2UsIG5vIHJlZnJlc2ggdG9rZW4sIGVuZGluZyB3aXRoIHRoYXQKIyBjcmVkZW50aWFsOiBQT1NUIC9hcGkvYXV0aGVudGljYXRpb24vc2VydmljZS10b2tlbiB7ImF1ZGllbmNlIjoiPGlkPiJ9LiBTZXQgaXQgb24gdGhlIGFwcCBhbmQgb24gYSBzZXBhcmF0ZSBhdXRoCiMgaG9zdCBhbGlrZS4KIyBJREVOVElUWV9fU0VSVklDRV9BVURJRU5DRVM9W3siaWQiOiJ3YXJlaG91c2UiLCJvcmlnaW4iOiJodHRwczovL2RhdGEuZXhhbXBsZS5jb20iLCJpbnRyb3NwZWN0aW9uX3NlY3JldF9zaGEyNTYiOiI8NjQgaGV4PiJ9XQojIE9BdXRoIGNsaWVudHMgdGhlIG9wZXJhdG9yIHJlZ2lzdGVycyAocHVibGljLCBQS0NFLCBubyBzZWNyZXQpOiBhIGZpeGVkIGlkIGFuZCByZWRpcmVjdHMgKGh0dHBzLCBvciBodHRwIG9uIGEKIyBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSwgYW5kIGEgbmFtZSBwZW9wbGUgc2VlIGF0IGNvbnNlbnQsIGUuZy4gYSBzZXJ2aWNlJ3Mgd2ViIGFwcGxpY2F0aW9uIHNpZ25pbmcgYnJvd3NlcnMgaW4KIyAocmVzb3VyY2U9PGl0cyBvcmlnaW4+LCBvciB0aGlzIEFQSSkuICJmaXJzdF9wYXJ0eSI6IHRydWUgbWFrZXMgaXQgcGFydCBvZiB0aGlzIGRlcGxveW1lbnQncyBzaWduLWluOiBubyBjb25zZW50CiMgcGFnZSwgYW5kIGl0cyBncmFudHMgZW5kIHdoZW4gdGhlIGJyb3dzZXIgc2Vzc2lvbiB0aGF0IGFwcHJvdmVkIHRoZW0gZW5kcyAoc2lnbi1vdXQpLgojIElERU5USVRZX19PQVVUSF9DTElFTlRTPVt7ImNsaWVudF9pZCI6IndhcmVob3VzZS13ZWIiLCJuYW1lIjoiV2FyZWhvdXNlIiwicmVkaXJlY3RfdXJpcyI6WyJodHRwczovL2RhdGEuZXhhbXBsZS5jb20vYXV0aC9jYWxsYmFjayJdLCJmaXJzdF9wYXJ0eSI6dHJ1ZX1dCiMgRGF0YSBzZXJ2aWNlcyBhIHBhZ2UgZnVuY3Rpb24ncyAndmlld2VyJyBjb25uZWN0aW9uIG1heSBiZSBib3VuZCB0bzogZWFjaCBpZCwgaXRzIHNlc3Npb24gZW5kcG9pbnQgYW5kIHRoZQojIElERU5USVRZX19TRVJWSUNFX0FVRElFTkNFUyBpZCBpdHMgdmlld2VyIHRva2VucyBhcmUgbWludGVkIGZvci4gRW1wdHk6IGEgJ3ZpZXdlcicgZGVjbGFyYXRpb24gcmVmdXNlcyBwdWJsaXNoLgojIEEgcGFnZSBydW4gY29ubmVjdHMgdG8gdGhlIGVuZHBvaW50IGEgc2Vzc2lvbiBuYW1lcywgd2l0aCB0aGUgVExTIG1vZGUgaXQgbmFtZXMsIHVuZGVyIHRoZSBydWxlIGV2ZXJ5IHJlc29sdmVyCiMgZGF0YWJhc2UgbWVldHM6IGEgcHVibGljIGFkZHJlc3MgKGFuIElQIGxpdGVyYWwgb3IgYSBuYW1lIG9mIHR3byBvciBtb3JlIGxhYmVscykgb3ZlciBUTFM7IGEgbG9vcGJhY2ssCiMgcGxhaW50ZXh0IGVuZHBvaW50IGlzIHJlYWNoZWQgb25seSB3aXRoIFJVTk5FUl9fREFUQUJBU0VfTE9PUEJBQ0s9dHJ1ZSAoZGV2ZWxvcG1lbnQgYW5kIHRlc3RzKS4KIyBEQVRBX1NFUlZJQ0VTX19UUlVTVEVEPVt7ImlkIjoid2FyZWhvdXNlIiwic2Vzc2lvbl91cmwiOiJodHRwczovL2RhdGEuZXhhbXBsZS5jb20vc2Vzc2lvbnMiLCJhdWRpZW5jZSI6IndhcmVob3VzZSJ9XQojIFBhZ2UtZnVuY3Rpb24gc2NoZWR1bGVzOiBvbiAodGhlIGRlZmF1bHQpIG9yIG9mZiAodGhlIHNjaGVkdWxlciBpcyBub3Qgc3RhcnRlZCBhbmQgYSBzYXZlIHRoYXQgd291bGQgc3RhcnQgYQojIHBhZ2Ugc2NoZWR1bGUgaXMgcmVmdXNlZCB3aXRoIHBhZ2Vfc2NoZWR1bGVzX2Rpc2FibGVkOyBvbi1kZW1hbmQgZnVuY3Rpb25zIGFyZSB1bmFmZmVjdGVkKS4KIyBTQ0hFRFVMRVNfX1BBR0VfU0NIRURVTEVTPW9uCiMgT3JpZ2lucyAoaHR0cHMsIG9yIGh0dHAgb24gYSBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSBhbGxvd2VkIHRvIGZyYW1lIGEgZG9jdW1lbnQncyBhZGRyZXNzOiB0aGUgL2EvPGlkPiBhcHAKIyBwYWdlIGFuZCB0aGUgZG9jdW1lbnQgaXQgZnJhbWVzLiBPbmx5IHRoZXkgbWF5IGZyYW1lIGl0cyBlbWJlZGRlZCB2aWV3ICgvYS88aWQ+P2VtYmVkPTEsIG5vIGFwcCBiYXIpLiBFbXB0eToKIyBmcmFtZWQgYnkgdGhlIGFwcCBhbG9uZS4KIyBFTUJFRF9fVFJVU1RFRF9PUklHSU5TPQoKIyBTcGxpdC1zZXJ2aWNlIGRlcGxveW1lbnQuIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVCBtdXN0IG1hdGNoIGFjcm9zcyBhcHAsIFNRTCwgYnJvd3NlciBhbmQgZXZlbnRzLgojIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQ9CiMgQlJPV1NFUl9fU0VSVklDRV9VUkw9aHR0cDovL2Jyb3dzZXI6ODA4MAojIE9wdGlvbmFsIGRpcmVjdCBleHBvcnQgdXBsb2FkOiB0aGUgYnJvd3NlciBzZXJ2aWNlIFBVVHMgZWFjaCByZW5kZXJlZCBpbWFnZSB0byB0aGUgYXBwJ3Mgc2lnbmVkIFVSTCBpdHNlbGYuCiMgVGhlIGV4YWN0IEhUVFBTIG9yaWdpbiB0aGUgYXBwJ3Mgc2lnbmVyIGVtaXRzLCBhbmQgdGhlIGFic29sdXRlIHBhdGggZW5kaW5nIGluIC9leHBvcnRzL29iamVjdHMvIChwYXRoLXN0eWxlCiMgc3RvcmFnZSBwdXRzIHRoZSBidWNrZXQgaW4gdGhlIHBhdGggdG9vKS4gVGhlIHVwbG9hZCBnYXRld2F5IGdldHMgdGhlIHNhbWUgdHdvIHZhbHVlcyBhbmQgbm8gUzMgY3JlZGVudGlhbHMuCiMgQlJPV1NFUl9fVVBMT0FEX09SSUdJTj1odHRwczovL2J1Y2tldC5zMy51cy13ZXN0LTEuYW1hem9uYXdzLmNvbQojIEJST1dTRVJfX1VQTE9BRF9QUkVGSVg9L2FydGlmYWN0cy9leHBvcnRzL29iamVjdHMvCiMgSW50ZXJuYWwtb25seSBicm93c2VycyByZWFjaCBTMyB0aHJvdWdoIHRoZSBzY29wZWQgdXBsb2FkIGdhdGV3YXkgKHNlcnZpY2VzL2Jyb3dzZXIvc3JjL3VwbG9hZC1nYXRld2F5LXNlcnZlci50cyksCiMgd2hpY2ggam9pbnMgdGhlIGNvbXB1dGUgYW5kIGVncmVzcyBuZXR3b3JrcywgcHVibGlzaGVzIG5vIHBvcnQsIGFkbWl0cyBvbmx5IGJvdW5kZWQgUE5HIGFuZCBKUEVHIFBVVHMgdG8gdGhhdAojIG9yaWdpbiBhbmQgcHJlZml4LCBhbmQgZm9sbG93cyBubyByZWRpcmVjdC4KIyBCUk9XU0VSX19VUExPQURfUFJPWFlfVVJMPWh0dHA6Ly91cGxvYWQtZ2F0ZXdheTo4MDgwCiMgQnJvd3NlciBzZXNzaW9ucyByZXF1aXJlIExpbnV4IGJ1YmJsZXdyYXAgd2l0aCB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLgojIERFVkVMT1BNRU5UIE9OTFkuIEJST1dTRVJfX1NBTkRCT1g9bm9uZSBydW5zIHRoZSBzZXNzaW9uIHdvcmtlciBhcyBhIHBsYWluIGNoaWxkCiMgcHJvY2Vzczogbm8gYnViYmxld3JhcCwgbm8gY2dyb3VwLCBOTyBPUyBjb250YWlubWVudCDigJQgYSBzZXNzaW9uIHNjcmlwdCB0aGVuIGhhcyB0aGUKIyB3aG9sZSBtYWNoaW5lLCB0aGlzIGNoZWNrb3V0IGFuZCB0aGUgbmV0d29yay4gSXQgZXhpc3RzIHNvIGxpdmUgc2Vzc2lvbnMgcnVuIG9uIGEKIyBtYWNPUyBkZXYgaG9zdCBhdCBhbGw7IGBucG0gcnVuIGRldmAgYWxyZWFkeSBkZWZhdWx0cyBpdCB0aGVyZS4gSXQgaXMgcmVmdXNlZCB3aGVuCiMgTk9ERV9FTlY9cHJvZHVjdGlvbiwgYW5kIGFueSBvdGhlciB2YWx1ZSBpcyByZWZ1c2VkIG91dHJpZ2h0LiBOZXZlciBzZXQgaXQgb24gYSBzZXJ2ZXIuCiMgQlJPV1NFUl9fU0FOREJPWD1ub25lCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMLCBBUFBfX1BBR0VTX0hPU1QgYW5kIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQgdGhlcmUuCiMgQlJPV1NFUl9fU0VTU0lPTl9BUFBfVVJMPWh0dHA6Ly9hcHA6ODA4MAojIFdyaXRhYmxlIGRlbGVnYXRlZCBjZ3JvdXAgdjIgc3VidHJlZSB3aXRoIGNwdSwgbWVtb3J5IGFuZCBwaWRzIGNvbnRyb2xsZXJzIGVuYWJsZWQuCiMgQlJPV1NFUl9fU0VTU0lPTl9DR1JPVVBfUk9PVD0vc3lzL2ZzL2Nncm91cC9hZmJpbi1zZXNzaW9ucwojIExpdmUgYnJvd3NlciBzZXNzaW9ucyB0aGlzIHNlcnZpY2UgaG9sZHMsIHNoYXJlZCBieSBldmVyeSBvd25lciwgYW5kIGhvdyBtYW55IG9uZQojIGNyZWRlbnRpYWwgbWF5IGhvbGQuIFdob2xlIG51bWJlcnMgb2YgYXQgbGVhc3QgMTsgZWFjaCBzZXNzaW9uIHN0aWxsIGdldHMgMSBHaUIuCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVg9MgojIEJST1dTRVJfX1NFU1NJT05fTUFYX1BFUl9BQ1RPUj0yCiMgQXV0aCBvd25lciBSUEMgb3JpZ2luIGZvciBzcGxpdC1ob3N0IGh1bWFuIHBhZ2VzIHNlc3Npb25zIChwcml2YXRlIHNlcnZpY2UgbmV0d29yaykuCiMgQVVUSF9fU0VSVklDRV9VUkw9aHR0cDovL2F1dGg6MzAwMAojIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVD0KIyBTUUxfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9zcWw6ODA4MAojIEV2ZW50cyB1c2UgdGhlIGxvY2FsIGRhdGFiYXNlIHVubGVzcyBhbiBIVFRQIHNlcnZpY2UgVVJMIGlzIGNvbmZpZ3VyZWQuCiMgRVZFTlRTX19TRVJWSUNFX1VSTD1odHRwOi8vZXZlbnRzOjgwODAKIyBFVkVOVFNfX1NDSEVNQT1ldmVudHMKRVhQT1JUX19JTlRFUk5BTF9PUklHSU49CgojIE9wdGlvbmFsIGRhdGFiYXNlIHNjaGVtYSBuYW1lcy4gQVVUSF9fU0NIRU1BIGFsc28gaG9sZHMgdGhlIGlkZW50aXR5IG1vZHVsZSdzIHRhYmxlcyAodXNlcnMsIHRva2VucywKIyBncm91cHMg4oCmKTsgSURFTlRJVFlfX1NDSEVNQSBpcyB0aGUgaWRlbnRpdHkgcmVhZCB2aWV3cyBldmVyeSByZWFkZXIgKHRoaXMgYXBwLCBvdGhlciBzZXJ2aWNlcykgcmVhZHMgdGhlbSB0aHJvdWdoLgojIEFVVEhfX1NDSEVNQT1hdXRoCiMgQVBQX19TQ0hFTUE9YXBwCiMgSURFTlRJVFlfX1NDSEVNQT1pZGVudGl0eQoKIyBPcHRpb25hbCBHb29nbGUgbG9naW4uCiMgQVVUSF9fR09PR0xFX0NMSUVOVF9JRD0KIyBBVVRIX19HT09HTEVfQ0xJRU5UX1NFQ1JFVD0KCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgoKCiMgUnVubmVyOiB1bnNldCBVUkwgdXNlcyB0aGUgbG9jYWwgc2VydmljZS4gUmVtb3RlIHJlcXVlc3RzIHJlcXVpcmUgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVC4KUlVOTkVSX19TRVJWSUNFX1VSTD0KIyBTZXQgYSBwaW5uZWQgd29ya2VyIGltYWdlIGZvciBEb2NrZXIgaXNvbGF0aW9uOyB1bnNldCB1c2VzIGEgbG9jYWwgY2hpbGQgcHJvY2Vzcy4KUlVOTkVSX19XT1JLRVJfSU1BR0U9ClJVTk5FUl9fTUFYX0NPTkNVUlJFTlQ9NAojIFN0YW5kYWxvbmUgcnVubmVyIGNvbnRyb2xsZXIgc2V0dGluZ3MuClJVTk5FUl9fUE9SVD0zMDUwClJVTk5FUl9fREFUQV9ESVI9Li9kYXRhL3J1bm5lcgpSVU5ORVJfX0FSVElGQUNUQklOX0JBU0VfVVJMPQojIERldmVsb3BtZW50IG9ubHk6IGB0cnVlYCBsZXRzIHJlc29sdmVyIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHJlYWNoIGxvb3BiYWNrIHdpdGhvdXQgVExTLiBOZXZlciBpbiBwcm9kdWN0aW9uLgpSVU5ORVJfX0RBVEFCQVNFX0xPT1BCQUNLPQoKIyBDb21wYW55IGhvc3RpbmcgcmVxdWlyZXMgYSBkZXNpZ25hdGVkIHZlcmlmaWVkIGJvb3RzdHJhcCBvd25lci4KQVBQX19ERVBMT1lNRU5UX01PREU9cHVibGljCkFQUF9fREVQTE9ZTUVOVF9PV05FUl9FTUFJTD0KQVVUSF9fSU5WSVRFX09OTFk9dHJ1ZQpBVVRIX19BTExPV0VEX0VNQUlMX1BBVFRFUk5TPSoKIyBUZXN0LWRvbWFpbiBhY2NvdW50cyBmb3IgYXV0b21hdGVkIHJ1bnMgKHRoZSBhZ2VudCBldmFscyk6IHdpdGggYm90aCBzZXQsIGFueSBhZGRyZXNzIGF0IGV4YWN0bHkgVEVTVF9ET01BSU4KIyAobm90IGEgc3ViZG9tYWluIG9yIGEgbG9vay1hbGlrZSkgc2lnbnMgaW4gd2l0aCBURVNUX0RPTUFJTl9PVFAgdGhyb3VnaCB0aGUgbm9ybWFsIGxvZ2luIGFuZCByZWNlaXZlcyBubyBtYWlsOwojIHRoZSBjb2RlIGlzIHNpbmdsZSB1c2Ugd2l0aCBmaXZlIGF0dGVtcHRzIGFuZCB0aGUgdXN1YWwgcmF0ZSBsaW1pdHMuIE5ldyByb3dzIGFyZSBtYXJrZWQgdXNlcnMudGVzdF9hY2NvdW50IGFuZAojIGJveGVkIGluIChzZXJ2aWNlcy9hcHAvbGliL2FjY291bnRzL3Rlc3QtYWNjb3VudHMudHMpLiBFaXRoZXIgdW5zZXQgPSBvZmY7IGFuIGludmFsaWQgcGFpciBpcyBvZmYgYW5kIGxvZ2dlZC4KIyBUaGUgaWRlbnRpdHkgc2VydmljZSBhbmQgdGhlIGFwcCBib3RoIHJlYWQgdGhlIHBhaXI6IGdpdmUgYSBzcGxpdCBkZXBsb3ltZW50IHRoZSBzYW1lIHZhbHVlcyBpbiBib3RoLgojIFRFU1RfRE9NQUlOX09UUDogMzItMTI4IGNoYXJhY3RlcnMgb2YgQS1aIGEteiAwLTkgLSBfIChlLmcuIG9wZW5zc2wgcmFuZCAtaGV4IDMyKS4KIyBURVNUX0RPTUFJTj0KIyBURVNUX0RPTUFJTl9PVFA9Cg==';
const ENV_EXAMPLE = Buffer.from(ENV_EXAMPLE_BASE64, 'base64').toString('utf8');

function httpUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return undefined;
  } catch {}
  return 'Public URL must be an absolute http(s) URL';
}

function portError(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) < 65535
    ? undefined
    : 'Port must be an integer from 1 to 65534 so the adjacent HMR port is valid';
}

function postgresUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname) return undefined;
  } catch {}
  return 'Database URL must be a Postgres URL';
}

/** APP__PAGES_HOST: a bare hostname (no scheme, port, path or wildcard), as services/app/lib/platform/config parsePagesHost reads it. */
function pagesHostError(value) {
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(String(value).trim().toLowerCase())
    ? undefined
    : 'Pages host must be a bare hostname such as lvh.me or pages.example.com';
}

/** The development pages host: `*.lvh.me` resolves to 127.0.0.1 in public DNS, with no hosts-file edit. */
const DEV_PAGES_HOST = 'lvh.me';

/**
 * Documents on their own origins need the app on the SAME SITE as the pages host (the frame's cookie is
 * SameSite=Lax), so a loopback public URL moves to `app.<pages host>` on the same port.
 */
function sameSitePublicUrl(publicUrl, pagesHost) {
  try {
    const url = new URL(publicUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (!pagesHost || !loopback) return publicUrl;
    url.hostname = `app.${pagesHost}`;
    return url.origin;
  } catch {
    return publicUrl;
  }
}

function s3UrlError(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 's3:' && url.hostname) return undefined;
  } catch {}
  return 'S3 URL must be an s3:// URL';
}

function portFromPublicUrl(publicUrl) {
  try {
    const port = new URL(publicUrl).port;
    return port ? Number(port) : 3030;
  } catch {
    return 3030;
  }
}

export function publicUrlWithPort(publicUrl, port) {
  const url = new URL(publicUrl);
  url.port = String(port);
  return url.origin;
}

function publicUrlFromPort(port) {
  return publicUrlWithPort(DEFAULT_PUBLIC_URL, port);
}

export function loopbackPublicUrlFollowsPort(publicUrl, port) {
  try {
    const url = new URL(publicUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
      || url.hostname === DEV_PAGES_HOST || url.hostname.endsWith(`.${DEV_PAGES_HOST}`);
    return loopback && Number(url.port) === Number(port);
  } catch {
    return false;
  }
}

function fromAddress(publicUrl) {
  return `artifactbin <login@${new URL(publicUrl).hostname}>`;
}

export function defaultAnswers(answerOverrides = {}) {
  const answers = {
    publicUrl: DEFAULT_PUBLIC_URL,
    port: 3030,
    email: '',
    emailFrom: '',
    database: 'pglite',
    databaseUrl: '',
    objects: 'local',
    s3Url: '',
    pagesHost: DEV_PAGES_HOST,
    ...answerOverrides,
  };
  if (answerOverrides.port !== undefined && answerOverrides.publicUrl === undefined) {
    answers.publicUrl = publicUrlFromPort(answerOverrides.port);
  } else if (answerOverrides.publicUrl !== undefined && answerOverrides.port === undefined) {
    answers.port = portFromPublicUrl(answerOverrides.publicUrl);
  }
  answers.publicUrl = sameSitePublicUrl(answers.publicUrl, answers.pagesHost);
  return answers;
}

function activeEnv(text) {
  const values = new Map();
  for (const line of String(text).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

/** The setup choices represented by an existing file. */
export function existingAnswers(text) {
  const values = activeEnv(text);
  const publicUrl = values.get('APP__PUBLIC_BASE_URL') || DEFAULT_PUBLIC_URL;
  const databaseUrl = values.get('DATABASE_URL') || '';
  const s3Url = values.get('S3_URL') || '';
  return defaultAnswers({
    publicUrl,
    port: values.has('APP__PORT') ? Number(values.get('APP__PORT')) : portFromPublicUrl(publicUrl),
    email: values.get('EMAIL__RESEND_API_KEY') || '',
    emailFrom: values.get('EMAIL__FROM') || '',
    database: databaseUrl ? 'postgres' : 'pglite',
    databaseUrl,
    objects: s3Url ? 's3' : 'local',
    s3Url,
    pagesHost: values.get('APP__PAGES_HOST') || DEV_PAGES_HOST,
  });
}

export function questions() {
  return [
    { key: 'publicUrl', prompt: 'APP__PUBLIC_BASE_URL — public URL people will use', default: DEFAULT_PUBLIC_URL, validate: httpUrlError },
    { key: 'port', prompt: 'APP__PORT — local port to listen on', default: (answers) => portFromPublicUrl(answers.publicUrl), validate: portError },
    { key: 'pagesHost', prompt: 'APP__PAGES_HOST — hostname documents are served under, same site as the public URL', default: DEV_PAGES_HOST, validate: pagesHostError },
    { key: 'email', prompt: 'EMAIL__RESEND_API_KEY — login email (optional)', default: '', validate: () => undefined, secret: true, clearable: true },
    { key: 'emailFrom', prompt: 'EMAIL__FROM — sender address', default: (answers) => fromAddress(answers.publicUrl), validate: (value) => String(value).trim() ? undefined : 'From address must not be blank', when: (answers) => Boolean(answers.email) },
    { key: 'database', prompt: 'DATABASE_URL — storage: [1] embedded PGLite  [2] Postgres URL', default: '1', validate: (value) => ['1', '2', 'pglite', 'postgres'].includes(String(value)) ? undefined : 'Database must be 1 or 2' },
    { key: 'databaseUrl', prompt: 'DATABASE_URL — Postgres URL', default: '', validate: postgresUrlError, secret: true, when: (answers) => answers.database === 'postgres' || answers.database === '2' },
    { key: 'objects', prompt: 'S3_URL — object storage: [1] local directory  [2] S3-compatible URL', default: '1', validate: (value) => ['1', '2', 'local', 's3'].includes(String(value)) ? undefined : 'Objects must be 1 or 2' },
    { key: 's3Url', prompt: 'S3_URL — S3-compatible URL', default: '', validate: s3UrlError, secret: true, when: (answers) => answers.objects === 's3' || answers.objects === '2' },
  ];
}

export function parseArgs(argv) {
  const result = { answers: {}, yes: false, noInterview: false, out: '.env', force: false, print: false };
  const values = new Map([
    ['--out', 'out'],
    ['--public-url', 'publicUrl'],
    ['--port', 'port'],
    ['--resend-key', 'email'],
    ['--email-from', 'emailFrom'],
    ['--database-url', 'databaseUrl'],
    ['--s3-url', 's3Url'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--yes') result.yes = true;
    else if (flag === '--no-interview') {
      result.yes = true;
      result.noInterview = true;
    } else if (flag === '--force') result.force = true;
    else if (flag === '--print') result.print = true;
    else if (flag === '--pages-host') {
      // `--pages-host` alone is development's lvh.me; `--pages-host <host>` names one.
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('--')) { result.answers.pagesHost = value.trim().toLowerCase(); index += 1; }
      else result.answers.pagesHost = DEV_PAGES_HOST;
    }
    else if (values.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined) return { ...result, error: `${flag} requires a value` };
      index += 1;
      const key = values.get(flag);
      if (key === 'out') result.out = value;
      else result.answers[key] = key === 'port' ? Number(value) : value;
    } else return { ...result, error: `Unknown flag: ${flag}` };
  }

  if (!result.out) return { ...result, error: 'Output path must not be blank' };
  if (result.answers.publicUrl !== undefined) {
    const error = httpUrlError(result.answers.publicUrl);
    if (error) return { ...result, error };
  }
  if (result.answers.port !== undefined) {
    const error = portError(result.answers.port);
    if (error) return { ...result, error };
  }
  if (result.answers.pagesHost !== undefined) {
    const error = pagesHostError(result.answers.pagesHost);
    if (error) return { ...result, error };
  }
  if (result.answers.databaseUrl !== undefined) {
    const error = postgresUrlError(result.answers.databaseUrl);
    if (error) return { ...result, error };
    result.answers.database = 'postgres';
  }
  if (result.answers.s3Url !== undefined) {
    const error = s3UrlError(result.answers.s3Url);
    if (error) return { ...result, error };
    result.answers.objects = 's3';
  }
  return result;
}

function validateAnswers(answers) {
  const publicUrlError = httpUrlError(answers.publicUrl);
  if (publicUrlError) throw new Error(publicUrlError);
  const answerPortError = portError(answers.port);
  if (answerPortError) throw new Error(answerPortError);
  if (answers.database === 'postgres') {
    const error = postgresUrlError(answers.databaseUrl);
    if (error) throw new Error(error);
  }
  if (answers.objects === 's3') {
    const error = s3UrlError(answers.s3Url);
    if (error) throw new Error(error);
  }
}

export function buildEnvFile(answerOverrides, { generated, validate = true }) {
  const answers = defaultAnswers(answerOverrides);
  if (validate) validateAnswers(answers);
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (!generated?.[name]) throw new Error(`Missing generated ${name}`);
  }

  let text = ENV_EXAMPLE
    .replace(/^ADMIN__SECRET=.*$/m, `ADMIN__SECRET=${generated.ADMIN__SECRET}`)
    .replace(/^AUTH__SECRET=.*$/m, `AUTH__SECRET=${generated.AUTH__SECRET}`)
    .replace(/^# CONTRACT__ACTOR_SECRET=.*$/m, `CONTRACT__ACTOR_SECRET=${generated.CONTRACT__ACTOR_SECRET}`)
    .replace(/^# INTERNAL__SERVICE_SECRET=.*$/m, `INTERNAL__SERVICE_SECRET=${generated.INTERNAL__SERVICE_SECRET}`)
    .replace(/^APP__PUBLIC_BASE_URL=.*$/m, `APP__PUBLIC_BASE_URL=${answers.publicUrl}`)
    .replace(/^APP__PORT=.*$/m, `APP__PORT=${answers.port}`);
  text = text.replace(/^APP__PAGES_HOST=.*$/m, `APP__PAGES_HOST=${answers.pagesHost || DEV_PAGES_HOST}`);
  if (new URL(answers.publicUrl).hostname.endsWith('.lvh.me')) text = text.replace(/^# APP__USER_PAGES_HOST=.*$/m, 'APP__USER_PAGES_HOST=u.lvh.me');

  if (answers.database === 'postgres') {
    text = text.replace(/^# DATABASE_URL=.*$/m, `DATABASE_URL=${answers.databaseUrl}`);
  }
  if (answers.email) {
    text = text
      .replace(/^EMAIL__RESEND_API_KEY=.*$/m, `EMAIL__RESEND_API_KEY=${answers.email}`)
      .replace(/^EMAIL__FROM=.*$/m, `EMAIL__FROM=${answers.emailFrom || fromAddress(answers.publicUrl)}`);
  } else {
    text = text
      .replace(/^EMAIL__RESEND_API_KEY=.*$/m, '# EMAIL__RESEND_API_KEY=')
      .replace(/^EMAIL__FROM=.*$/m, '# EMAIL__FROM=');
  }
  if (answers.objects === 's3') {
    text = text
      .replace(/^# S3_URL=.*$/m, `S3_URL=${answers.s3Url}`)
      .replace(/^OBJECT_STORE__LOCAL_DIR=.*$/m, '# OBJECT_STORE__LOCAL_DIR=./data/objects');
  } else {
    text = text.replace(/^OBJECT_STORE__LOCAL_DIR=.*$/m, 'OBJECT_STORE__LOCAL_DIR=./data/objects');
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

const MANAGED_ENV = {
  publicUrl: ['APP__PUBLIC_BASE_URL'], port: ['APP__PORT'], pagesHost: ['APP__PAGES_HOST', 'APP__PUBLIC_BASE_URL'],
  email: ['EMAIL__RESEND_API_KEY', 'EMAIL__FROM'], emailFrom: ['EMAIL__FROM'],
  database: ['DATABASE_URL'], databaseUrl: ['DATABASE_URL'],
  objects: ['S3_URL', 'OBJECT_STORE__LOCAL_DIR'], s3Url: ['S3_URL', 'OBJECT_STORE__LOCAL_DIR'],
};

function replaceEnvLine(text, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^#?[ \\t]*${escaped}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `${name}=${value}`);
  return `${text.trimEnd()}\n${name}=${value}\n`;
}

/**
 * Rebuild against the current example while retaining every configured value.
 * Only choices explicitly supplied by the caller replace existing values.
 */
export function mergeEnvFile(existingText, answerOverrides, { generated, supplied = new Set(Object.keys(answerOverrides)) }) {
  const current = activeEnv(existingText);
  const prior = existingAnswers(existingText);
  const effectiveSupplied = new Set(supplied);
  // A file written before APP__PAGES_HOST was required gets the development pages host, and its loopback
  // public URL moves onto the same site with it (defaultAnswers sameSitePublicUrl).
  if (!current.get('APP__PAGES_HOST')) effectiveSupplied.add('pagesHost');
  const explicit = Object.fromEntries([...effectiveSupplied].filter((key) => key in answerOverrides).map((key) => [key, answerOverrides[key]]));
  if (effectiveSupplied.has('port') && !effectiveSupplied.has('publicUrl') && loopbackPublicUrlFollowsPort(prior.publicUrl, prior.port)) {
    explicit.publicUrl = publicUrlWithPort(prior.publicUrl, answerOverrides.port);
    effectiveSupplied.add('publicUrl');
  }
  const answers = defaultAnswers({ ...prior, ...explicit });
  const secrets = { ...generated };
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (current.get(name)) secrets[name] = current.get(name);
  }
  // Explicit replacements were validated at the CLI/interview boundary.
  // Existing values are preserved verbatim, even when the editor would not
  // create them (for example a driver-specific connection-string spelling).
  let text = buildEnvFile(answers, { generated: secrets, validate: false });
  const replaced = new Set([...effectiveSupplied].flatMap((key) => MANAGED_ENV[key] ?? []));
  for (const [name, value] of current) {
    if (!replaced.has(name)) text = replaceEnvLine(text, name, value);
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}
