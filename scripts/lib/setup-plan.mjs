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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAocmVzb2x2ZXIgZGF0YWJhc2VzLCBjYXBzLmZldGNoLCB3ZWJob29rcykuCiMgQ29tbWEtc2VwYXJhdGVkIElQdjQgb3IgSVB2Njsgc2VydmVkIGF0IEdFVCAvYXBpL291dGJvdW5kLWlwcyBhbmQgc2hvd24gaW4gdGhlIFJlc29sdmVycyBwYW5lbCBzbyBvd25lcnMKIyBrbm93IHdoYXQgdG8gYWxsb3cgaW4gYSBkYXRhYmFzZSBmaXJld2FsbC4gVW5zZXQgc2VydmVzIGFuIGVtcHR5IGxpc3Q7IGEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19PVVRCT1VORF9JUFM9MjAzLjAuMTEzLjEwCiMgUkVRVUlSRUQuIEV2ZXJ5IGRvY3VtZW50IGlzIHNlcnZlZCBvbiBpdHMgb3duIG9yaWdpbiwgPGhleCBpZD4uPHRoaXMgaG9zdD4sIGZyYW1lZCBieSB0aGUgYXBwIHBhZ2UuCiMgQSBiYXJlIGhvc3RuYW1lOyBzY2hlbWUgYW5kIHBvcnQgZm9sbG93IEFQUF9fUFVCTElDX0JBU0VfVVJMLiBVbnNldCByZWZ1c2VzIHRoZSBib290LiBPdmVyIGh0dHBzIGl0IG1heSBiZQojIGEgcmVnaXN0cmFibGUgZG9tYWluIG9mIGl0cyBvd24gKHJlY29tbWVuZGVkIGluIHByb2R1Y3Rpb247IHRoZSBmcmFtZSdzIGNvb2tpZSBpcyBTYW1lU2l0ZT1Ob25lOyBQYXJ0aXRpb25lZCksCiMgd2l0aCB3aWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgKi48aG9zdD4uIE92ZXIgcGxhaW4gaHR0cCB0aGUgYXBwIG11c3QgYmUgb24gdGhlIHNhbWUgc2l0ZSAoU2FtZVNpdGU9TGF4KS4KIyBEZXZlbG9wbWVudDogbHZoLm1lLCBicm93c2luZyB0aGUgYXBwIGF0IGh0dHA6Ly9hcHAubHZoLm1lOjxwb3J0PiAobnBtIHJ1biBzZXR1cCB3cml0ZXMgYm90aCkuCkFQUF9fUEFHRVNfSE9TVD1sdmgubWUKQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYXNzZXRzIHBlciBhY2NvdW50ICh1cGxvYWRzICsgVVJMcyBpbXBvcnRlZCBmaXJzdCksIDEwIEdCOyBhbm9ueW1vdXMgdG9rZW5zIGhhdmUgdGhlaXIgb3duIGNhcC4gMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49MTAwMDAwMDAwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgojIEVNQUlMX19ERVZfT1VUQk9YX1BBVEg9CiMgUHVibGljIGVtYWlsLWNvZGUgbG9naW4gdXNlcyBlaXRoZXIgU01UUCBvciBSZXNlbmQgd2l0aCBhbiBhdXRob3JpemVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQojIFNNVFAgYWx0ZXJuYXRpdmU6IGRlZmF1bHQgcG9ydCA1ODcgcmVxdWlyZXMgU1RBUlRUTFM7IHNlY3VyZT10cnVlIHVzZXMgaW1wbGljaXQgVExTIChkZWZhdWx0IDQ2NSkuCkVNQUlMX19TTVRQX0hPU1Q9CkVNQUlMX19TTVRQX1BPUlQ9CkVNQUlMX19TTVRQX1NFQ1VSRT0KRU1BSUxfX1NNVFBfVVNFUj0KRU1BSUxfX1NNVFBfUEFTU1dPUkQ9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAwClBERl9fTUFYX0JZVEVTPTUwMDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgTnVtYmVyIG9mIHRydXN0ZWQgZm9yd2FyZGluZyBob3BzIHVzZWQgdG8gaW50ZXJwcmV0IGNsaWVudCBhZGRyZXNzZXMuCkhUVFBfX1RSVVNURURfUFJPWFlfSE9QUz0xCgojIE9wdGlvbmFsIGRlcGxveW1lbnQgY29udHJvbHMuCiMgQVJUSUZBQ1RTX19BTExPV19QVUJMSUM9MQojIERldmVsb3BtZW50IGFuZCB0ZXN0IG9ubHk6IGxldCBwYWdlIGZ1bmN0aW9ucyBiZSBzY2hlZHVsZWQgbW9yZSBvZnRlbiB0aGFuIGV2ZXJ5IDE1IG1pbnV0ZXMgKHdob2xlIG1pbnV0ZXMpLgojIFNDSEVEVUxFU19fTUlOX0lOVEVSVkFMX01JTlVURVM9MQojIEFub255bW91cyB1c2VyL2dyb3VwIHB1Ymxpc2hpbmcgaG9zdHMuIE9mZiBieSBkZWZhdWx0OyBhIGJhcmUgaG9zdG5hbWUuIEVhY2ggbGl2ZSB1c2VyIG9yIGdyb3VwIGhhbmRsZQojICh1bmRlcnNjb3JlcyBiZWNvbWUgaHlwaGVucykgZ2V0cyA8aGFuZGxlPi48dGhpcyBob3N0PjogcHVibGljIEhUTUwgb24gaXRzIGhvbWUsIHVubGlzdGVkIGJ5IElEIG9ubHkgKG5vaW5kZXgsCiMgbm8tcmVmZXJyZXIpLiBFdmVyeSByZXF1ZXN0IHRoZXJlIGlzIGEgZ3Vlc3QncywgY29va2llcyBvciBub3Q6IHNxbCByZWFkcyBhbmQgR0VUIGZ1bmN0aW9ucyBvbmx5LgojIFdpbGRjYXJkIEROUyBhbmQgVExTIGZvciBpdCBhcmUgdGhlIG9wZXJhdG9yJ3M7IHRoZSBwcm9kdWN0IG5ldmVyIHByb3Zpc2lvbnMgYSBob3N0bmFtZS4KIyBBUFBfX1VTRVJfUEFHRVNfSE9TVD11LmV4YW1wbGUuY29tCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIENvbWJpbmVkIG1vZGU6IHRoaXMgaW5zdGFsbGF0aW9uIGFsc28gcnVucyB0aGUgTWludXNYIGRhdGEgc2VydmljZS4gU2V0dGluZyBNSU5VU1hfX0JBU0VfVVJMICh0aGUgTWludXNYCiMgY29udHJvbCBBUEkgb3JpZ2luKSB0dXJucyBpdCBvbiBhbmQgdGhlbiByZXF1aXJlcyB0aGUgb3RoZXIgdGhyZWU6IHRoZSBpbnN0YWxsYXRpb24ncyBzdGFibGUgaWQsIGFuZCB0aGUKIyBFZDI1NTE5IGtleSAoUEtDUyM4IFBFTTsgd3JpdGUgbmV3bGluZXMgYXMgXG4gb24gb25lIGxpbmUpIGFuZCBraWQgdGhhdCBzaWduIGRlbGVnYXRpb24gdG9rZW5zLiBNaW51c1ggaXMKIyBjb25maWd1cmVkIHdpdGggdGhlIG1hdGNoaW5nIHB1YmxpYyBrZXkuIFBhZ2VzIG1heSB0aGVuIHJlYWQgZ292ZXJuZWQgY29ubmVjdGlvbnMgKCdtaW51c3gnIGluIGEgZnVuY3Rpb24ncwojIHNlY3JldHMpIGFzIGVhY2ggdmlld2VyLiBVbnNldCwgQXJ0aWZhY3RiaW4gcnVucyBzdGFuZGFsb25lIGV4YWN0bHkgYXMgYmVmb3JlLgojIElOU1RBTExBVElPTl9fSUQ9aW5zdGFsbGF0aW9uX2RlbW8KIyBNSU5VU1hfX0JBU0VfVVJMPWh0dHA6Ly9taW51c3g6ODA4MAojIE1JTlVTWF9fREVMRUdBVElPTl9QUklWQVRFX0tFWT0KIyBNSU5VU1hfX0RFTEVHQVRJT05fS0VZX0lEPQojIFdobyBydW5zIHJlY3VycmluZyB3b3JrOiBhcnRpZmFjdGJpbiAodGhlIGRlZmF1bHQ6IHBhZ2UtZnVuY3Rpb24gc2NoZWR1bGVzIHJ1biBoZXJlKSBvciBtaW51c3ggKHRoZSBwYWdlCiMgc2NoZWR1bGVyIGlzIG5vdCBzdGFydGVkIGFuZCBhIHNhdmUgZGVjbGFyaW5nIGEgbmV3IHBhZ2Ugc2NoZWR1bGUgaXMgcmVmdXNlZDsgTWludXNYIHNjaGVkdWxlcyBqb2JzIGluc3RlYWQpLgojIFNDSEVEVUxFU19fT1dORVI9YXJ0aWZhY3RiaW4KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBPcHRpb25hbCBkaXJlY3QgZXhwb3J0IHVwbG9hZDogdGhlIGJyb3dzZXIgc2VydmljZSBQVVRzIGVhY2ggcmVuZGVyZWQgaW1hZ2UgdG8gdGhlIGFwcCdzIHNpZ25lZCBVUkwgaXRzZWxmLgojIFRoZSBleGFjdCBIVFRQUyBvcmlnaW4gdGhlIGFwcCdzIHNpZ25lciBlbWl0cywgYW5kIHRoZSBhYnNvbHV0ZSBwYXRoIGVuZGluZyBpbiAvZXhwb3J0cy9vYmplY3RzLyAocGF0aC1zdHlsZQojIHN0b3JhZ2UgcHV0cyB0aGUgYnVja2V0IGluIHRoZSBwYXRoIHRvbykuIFRoZSB1cGxvYWQgZ2F0ZXdheSBnZXRzIHRoZSBzYW1lIHR3byB2YWx1ZXMgYW5kIG5vIFMzIGNyZWRlbnRpYWxzLgojIEJST1dTRVJfX1VQTE9BRF9PUklHSU49aHR0cHM6Ly9idWNrZXQuczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20KIyBCUk9XU0VSX19VUExPQURfUFJFRklYPS9hcnRpZmFjdHMvZXhwb3J0cy9vYmplY3RzLwojIEludGVybmFsLW9ubHkgYnJvd3NlcnMgcmVhY2ggUzMgdGhyb3VnaCB0aGUgc2NvcGVkIHVwbG9hZCBnYXRld2F5IChzZXJ2aWNlcy9icm93c2VyL3NyYy91cGxvYWQtZ2F0ZXdheS1zZXJ2ZXIudHMpLAojIHdoaWNoIGpvaW5zIHRoZSBjb21wdXRlIGFuZCBlZ3Jlc3MgbmV0d29ya3MsIHB1Ymxpc2hlcyBubyBwb3J0LCBhZG1pdHMgb25seSBib3VuZGVkIFBORyBhbmQgSlBFRyBQVVRzIHRvIHRoYXQKIyBvcmlnaW4gYW5kIHByZWZpeCwgYW5kIGZvbGxvd3Mgbm8gcmVkaXJlY3QuCiMgQlJPV1NFUl9fVVBMT0FEX1BST1hZX1VSTD1odHRwOi8vdXBsb2FkLWdhdGV3YXk6ODA4MAojIEJyb3dzZXIgc2Vzc2lvbnMgcmVxdWlyZSBMaW51eCBidWJibGV3cmFwIHdpdGggdW5wcml2aWxlZ2VkIHVzZXIgbmFtZXNwYWNlcy4KIyBERVZFTE9QTUVOVCBPTkxZLiBCUk9XU0VSX19TQU5EQk9YPW5vbmUgcnVucyB0aGUgc2Vzc2lvbiB3b3JrZXIgYXMgYSBwbGFpbiBjaGlsZAojIHByb2Nlc3M6IG5vIGJ1YmJsZXdyYXAsIG5vIGNncm91cCwgTk8gT1MgY29udGFpbm1lbnQg4oCUIGEgc2Vzc2lvbiBzY3JpcHQgdGhlbiBoYXMgdGhlCiMgd2hvbGUgbWFjaGluZSwgdGhpcyBjaGVja291dCBhbmQgdGhlIG5ldHdvcmsuIEl0IGV4aXN0cyBzbyBsaXZlIHNlc3Npb25zIHJ1biBvbiBhCiMgbWFjT1MgZGV2IGhvc3QgYXQgYWxsOyBgbnBtIHJ1biBkZXZgIGFscmVhZHkgZGVmYXVsdHMgaXQgdGhlcmUuIEl0IGlzIHJlZnVzZWQgd2hlbgojIE5PREVfRU5WPXByb2R1Y3Rpb24sIGFuZCBhbnkgb3RoZXIgdmFsdWUgaXMgcmVmdXNlZCBvdXRyaWdodC4gTmV2ZXIgc2V0IGl0IG9uIGEgc2VydmVyLgojIEJST1dTRVJfX1NBTkRCT1g9bm9uZQojIFNwbGl0IGJyb3dzZXIgc2VydmljZTogdHJ1c3RlZCBhcHAgVVJMOyBhbHNvIHNldCBBUFBfX1BVQkxJQ19CQVNFX1VSTCwgQVBQX19QQUdFU19IT1NUIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBMaXZlIGJyb3dzZXIgc2Vzc2lvbnMgdGhpcyBzZXJ2aWNlIGhvbGRzLCBzaGFyZWQgYnkgZXZlcnkgb3duZXIsIGFuZCBob3cgbWFueSBvbmUKIyBjcmVkZW50aWFsIG1heSBob2xkLiBXaG9sZSBudW1iZXJzIG9mIGF0IGxlYXN0IDE7IGVhY2ggc2Vzc2lvbiBzdGlsbCBnZXRzIDEgR2lCLgojIEJST1dTRVJfX1NFU1NJT05fTUFYPTIKIyBCUk9XU0VSX19TRVNTSU9OX01BWF9QRVJfQUNUT1I9MgojIEF1dGggb3duZXIgUlBDIG9yaWdpbiBmb3Igc3BsaXQtaG9zdCBodW1hbiBwYWdlcyBzZXNzaW9ucyAocHJpdmF0ZSBzZXJ2aWNlIG5ldHdvcmspLgojIEFVVEhfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9hdXRoOjMwMDAKIyBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQ9CiMgU1FMX19TRVJWSUNFX1VSTD1odHRwOi8vc3FsOjgwODAKIyBFdmVudHMgdXNlIHRoZSBsb2NhbCBkYXRhYmFzZSB1bmxlc3MgYW4gSFRUUCBzZXJ2aWNlIFVSTCBpcyBjb25maWd1cmVkLgojIEVWRU5UU19fU0VSVklDRV9VUkw9aHR0cDovL2V2ZW50czo4MDgwCiMgRVZFTlRTX19TQ0hFTUE9ZXZlbnRzCkVYUE9SVF9fSU5URVJOQUxfT1JJR0lOPQoKIyBPcHRpb25hbCBkYXRhYmFzZSBzY2hlbWEgbmFtZXMuCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAKCiMgT3B0aW9uYWwgR29vZ2xlIGxvZ2luLgojIEFVVEhfX0dPT0dMRV9DTElFTlRfSUQ9CiMgQVVUSF9fR09PR0xFX0NMSUVOVF9TRUNSRVQ9CgojIE9wdGlvbmFsIE9JREMgbG9naW4uIFVzZSBleHBsaWNpdCBlbmRwb2ludHMgb3IgZGlzY292ZXJ5LCBub3QgYm90aC4KIyBBVVRIX19PSURDX1BST1ZJREVSX0lEPW9pZGMKIyBBVVRIX19PSURDX0NMSUVOVF9JRD0KIyBBVVRIX19PSURDX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19BVVRIT1JJWkFUSU9OX1VSTD0KIyBBVVRIX19PSURDX1RPS0VOX1VSTD0KIyBBVVRIX19PSURDX1VTRVJJTkZPX1VSTD0KIyBBVVRIX19PSURDX0RJU0NPVkVSWV9VUkw9CgoKCgojIFJ1bm5lcjogdW5zZXQgVVJMIHVzZXMgdGhlIGxvY2FsIHNlcnZpY2UuIFJlbW90ZSByZXF1ZXN0cyByZXF1aXJlIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQuClJVTk5FUl9fU0VSVklDRV9VUkw9CiMgU2V0IGEgcGlubmVkIHdvcmtlciBpbWFnZSBmb3IgRG9ja2VyIGlzb2xhdGlvbjsgdW5zZXQgdXNlcyBhIGxvY2FsIGNoaWxkIHByb2Nlc3MuClJVTk5FUl9fV09SS0VSX0lNQUdFPQpSVU5ORVJfX01BWF9DT05DVVJSRU5UPTQKIyBTdGFuZGFsb25lIHJ1bm5lciBjb250cm9sbGVyIHNldHRpbmdzLgpSVU5ORVJfX1BPUlQ9MzA1MApSVU5ORVJfX0RBVEFfRElSPS4vZGF0YS9ydW5uZXIKUlVOTkVSX19BUlRJRkFDVEJJTl9CQVNFX1VSTD0KIyBEZXZlbG9wbWVudCBvbmx5OiBgdHJ1ZWAgbGV0cyByZXNvbHZlciBkYXRhYmFzZSBjb25uZWN0aW9ucyByZWFjaCBsb29wYmFjayB3aXRob3V0IFRMUy4gTmV2ZXIgaW4gcHJvZHVjdGlvbi4KUlVOTkVSX19EQVRBQkFTRV9MT09QQkFDSz0KCiMgQ29tcGFueSBob3N0aW5nIHJlcXVpcmVzIGEgZGVzaWduYXRlZCB2ZXJpZmllZCBib290c3RyYXAgb3duZXIuCkFQUF9fREVQTE9ZTUVOVF9NT0RFPXB1YmxpYwpBUFBfX0RFUExPWU1FTlRfT1dORVJfRU1BSUw9CkFVVEhfX0lOVklURV9PTkxZPXRydWUKQVVUSF9fQUxMT1dFRF9FTUFJTF9QQVRURVJOUz0qCiMgVGVzdC1kb21haW4gYWNjb3VudHMgZm9yIGF1dG9tYXRlZCBydW5zICh0aGUgYWdlbnQgZXZhbHMpOiB3aXRoIGJvdGggc2V0LCBhbnkgYWRkcmVzcyBhdCBleGFjdGx5IFRFU1RfRE9NQUlOCiMgKG5vdCBhIHN1YmRvbWFpbiBvciBhIGxvb2stYWxpa2UpIHNpZ25zIGluIHdpdGggVEVTVF9ET01BSU5fT1RQIHRocm91Z2ggdGhlIG5vcm1hbCBsb2dpbiBhbmQgcmVjZWl2ZXMgbm8gbWFpbDsKIyB0aGUgY29kZSBpcyBzaW5nbGUgdXNlIHdpdGggZml2ZSBhdHRlbXB0cyBhbmQgdGhlIHVzdWFsIHJhdGUgbGltaXRzLiBOZXcgcm93cyBhcmUgbWFya2VkIHVzZXJzLnRlc3RfYWNjb3VudCBhbmQKIyBib3hlZCBpbiAoc2VydmljZXMvYXBwL2xpYi9hY2NvdW50cy90ZXN0LWFjY291bnRzLnRzKS4gRWl0aGVyIHVuc2V0ID0gb2ZmOyBhbiBpbnZhbGlkIHBhaXIgaXMgb2ZmIGFuZCBsb2dnZWQuCiMgVGhlIGlkZW50aXR5IHNlcnZpY2UgYW5kIHRoZSBhcHAgYm90aCByZWFkIHRoZSBwYWlyOiBnaXZlIGEgc3BsaXQgZGVwbG95bWVudCB0aGUgc2FtZSB2YWx1ZXMgaW4gYm90aC4KIyBURVNUX0RPTUFJTl9PVFA6IDMyLTEyOCBjaGFyYWN0ZXJzIG9mIEEtWiBhLXogMC05IC0gXyAoZS5nLiBvcGVuc3NsIHJhbmQgLWhleCAzMikuCiMgVEVTVF9ET01BSU49CiMgVEVTVF9ET01BSU5fT1RQPQo=';
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
