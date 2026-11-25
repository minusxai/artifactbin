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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAod2ViIGluZ2VzdGlvbiwgd2ViaG9va3MpLgojIENvbW1hLXNlcGFyYXRlZCBJUHY0IG9yIElQdjY7IHNlcnZlZCBhdCBHRVQgL2FwaS9vdXRib3VuZC1pcHMgc28gb3duZXJzIGtub3cgd2hhdCB0byBhbGxvdyBpbiBhIGZpcmV3YWxsLiBVbnNldCBzZXJ2ZXMgYW4gZW1wdHkgbGlzdDsgYSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX09VVEJPVU5EX0lQUz0yMDMuMC4xMTMuMTAKIyBSRVFVSVJFRC4gRXZlcnkgZG9jdW1lbnQgaXMgc2VydmVkIG9uIGl0cyBvd24gb3JpZ2luLCA8aGV4IGlkPi48dGhpcyBob3N0PiwgZnJhbWVkIGJ5IHRoZSBhcHAgcGFnZS4KIyBBIGJhcmUgaG9zdG5hbWU7IHNjaGVtZSBhbmQgcG9ydCBmb2xsb3cgQVBQX19QVUJMSUNfQkFTRV9VUkwuIFVuc2V0IHJlZnVzZXMgdGhlIGJvb3QuIE92ZXIgaHR0cHMgaXQgbWF5IGJlCiMgYSByZWdpc3RyYWJsZSBkb21haW4gb2YgaXRzIG93biAocmVjb21tZW5kZWQgaW4gcHJvZHVjdGlvbjsgdGhlIGZyYW1lJ3MgY29va2llIGlzIFNhbWVTaXRlPU5vbmU7IFBhcnRpdGlvbmVkKSwKIyB3aXRoIHdpbGRjYXJkIEROUyBhbmQgVExTIGZvciAqLjxob3N0Pi4gT3ZlciBwbGFpbiBodHRwIHRoZSBhcHAgbXVzdCBiZSBvbiB0aGUgc2FtZSBzaXRlIChTYW1lU2l0ZT1MYXgpLgojIERldmVsb3BtZW50OiBsdmgubWUsIGJyb3dzaW5nIHRoZSBhcHAgYXQgaHR0cDovL2FwcC5sdmgubWU6PHBvcnQ+IChucG0gcnVuIHNldHVwIHdyaXRlcyBib3RoKS4KQVBQX19QQUdFU19IT1NUPWx2aC5tZQpBUFBfX1BPUlQ9MzAzMAojIEFQUF9fSE9TVD0KQVBQX19ITVJfUE9SVD0KCiMgUGVyLXRva2VuIGFydGlmYWN0IGNhcDsgMCBkaXNhYmxlcyB0aGUgY2FwLgpRVU9UQV9fQVJUSUZBQ1RTX1BFUl9UT0tFTj0xMDAwCgojIFN0b3JlZCBhc3NldHMgcGVyIGFjY291bnQgKHVwbG9hZHMgKyBVUkxzIGltcG9ydGVkIGZpcnN0KSwgMTAgR0I7IGFub255bW91cyB0b2tlbnMgaGF2ZSB0aGVpciBvd24gY2FwLiAwIGRpc2FibGVzLgojIEFTU0VUU19fTUFYX0JZVEVTX1BFUl9UT0tFTj0xMDAwMDAwMDAwMAoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZW1haWwtY29kZSBsb2dpbiB1c2VzIGVpdGhlciBTTVRQIG9yIFJlc2VuZCB3aXRoIGFuIGF1dGhvcml6ZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CiMgU01UUCBhbHRlcm5hdGl2ZTogZGVmYXVsdCBwb3J0IDU4NyByZXF1aXJlcyBTVEFSVFRMUzsgc2VjdXJlPXRydWUgdXNlcyBpbXBsaWNpdCBUTFMgKGRlZmF1bHQgNDY1KS4KRU1BSUxfX1NNVFBfSE9TVD0KRU1BSUxfX1NNVFBfUE9SVD0KRU1BSUxfX1NNVFBfU0VDVVJFPQpFTUFJTF9fU01UUF9VU0VSPQpFTUFJTF9fU01UUF9QQVNTV09SRD0KRU1BSUxfX0ZST009YXJ0aWZhY3RiaW4gPGxvZ2luQGV4YW1wbGUuY29tPgojIFRoZSBwcm9kdWN0IG5hbWUgc2lnbi1pbiBtYWlsIG5hbWVzIChzdWJqZWN0IGFuZCBib2R5KSwgZm9yIGFuIGluc3RhbGwgcHJlc2VudGVkIHVuZGVyIGFub3RoZXIgbmFtZTsgcGxhaW4gdGV4dCwgb25lCiMgbGluZSwgYXQgbW9zdCA2MCBjaGFyYWN0ZXJzLiBVbnNldDogYXJ0aWZhY3RiaW4uIEludmFsaWQ6IG5vIGJvb3QuCiMgQVBQX19OQU1FPUFjbWUgRGF0YQoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMDAKUERGX19NQVhfQllURVM9NTAwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKCiMgTW9zdCByb3dzIGEgZGF0YXNldCBrZWVwcyBhbmQgb25lIHF1ZXJ5IHJlc3VsdCBjYXJyaWVzLgpTUUxfX01BWF9ST1dTPTEwMDAwCiMgUmVhZCBleGVjdXRpb24gY2FwIChwb3NpdGl2ZSBpbnRlZ2VyLCBtYXhpbXVtIDEyMDAwMCk7IHdob2xlIHJlYWQgYWxsb3dzIDE1MDAwbXMgb3ZlcmhlYWQuCiMgTGVhdmUgdW5zZXQgZm9yIHRoZSAzMDAwMG1zIGRlZmF1bHQuIERhdGFzZXQgd3JpdGVzIGFsd2F5cyBnZXQgNTAwMG1zLgojIFNRTF9fUVVFUllfVElNRU9VVF9NUz0zMDAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgaW4gZnJvbnQgb2YgdGhpcyBhcHA6IHRoZXkgc2V0IFgtRm9yd2FyZGVkLUZvci8tSG9zdC8tUHJvdG8sIHJlYWQgdGhhdCBtYW55CiMgZW50cmllcyBmcm9tIHRoZSBlbmQuIDA6IG5vIHByb3h5LCBzbyB0aG9zZSBoZWFkZXJzIGFyZSBpZ25vcmVkIGFuZCBIb3N0IGlzIHRoZSBhZGRyZXNzZWQgaG9zdCAoYW5vbnltb3VzCiMgcmVhZGVycyB0aGVuIHNoYXJlIG9uZSByYXRlLWxpbWl0IGJ1Y2tldDogbm8gYWRkcmVzcyBpZGVudGlmaWVzIHRoZW0pLgpIVFRQX19UUlVTVEVEX1BST1hZX0hPUFM9MQoKIyBPcHRpb25hbCBkZXBsb3ltZW50IGNvbnRyb2xzLgojIEFSVElGQUNUU19fQUxMT1dfUFVCTElDPTEKIyBBbm9ueW1vdXMgdXNlci9ncm91cCBwdWJsaXNoaW5nIGhvc3RzLiBPZmYgYnkgZGVmYXVsdDsgYSBiYXJlIGhvc3RuYW1lLiBFYWNoIGxpdmUgdXNlciBvciBncm91cCBoYW5kbGUKIyAodW5kZXJzY29yZXMgYmVjb21lIGh5cGhlbnMpIGdldHMgPGhhbmRsZT4uPHRoaXMgaG9zdD46IHB1YmxpYyBIVE1MIG9uIGl0cyBob21lLCB1bmxpc3RlZCBieSBJRCBvbmx5IChub2luZGV4LAojIG5vLXJlZmVycmVyKS4gRXZlcnkgcmVxdWVzdCB0aGVyZSBpcyBhIGd1ZXN0J3MsIGNvb2tpZXMgb3Igbm90OiBzcWwgcmVhZHMgb25seS4KIyBOYW1lZCBwZXJzb25hbCBmb2xkZXIgc2l0ZXMgdXNlIDxoYW5kbGU+LS08bGFiZWw+Ljx0aGlzIGhvc3Q+LCB3aXRoaW4gdGhlIHNhbWUgNjMtY2hhcmFjdGVyIEROUyBsYWJlbC4KIyBXaWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgaXQgYXJlIHRoZSBvcGVyYXRvcidzOyB0aGUgcHJvZHVjdCBuZXZlciBwcm92aXNpb25zIGEgaG9zdG5hbWUuCiMgQVBQX19VU0VSX1BBR0VTX0hPU1Q9dS5leGFtcGxlLmNvbQojIEEgY3VzdG9tIHNoZWxsOiBvbmUgSFRNTCBmaWxlIHRoaXMgcHJvY2VzcyBjYW4gcmVhZCwgc2VydmVkICgyMDAsIG5vLXN0b3JlLCB0aGUgYXBwJ3MgQ1NQLCBhIExpbmsgcmVsPSJoZWxwIiB0bwojIC9sbG1zLnR4dCkgaW4gcGxhY2Ugb2YgdGhlIGFwcCdzIG93biBzY3JlZW5zOiBleGFjdGx5IHRoZSBhZGRyZXNzZXMgdGhlIFVSTCBtYXAgY2FsbHMgc2NyZWVucyAoL2FmL3VybC1zcGFjZS5qc29uLAojIGNvbnRyYWN0cyBpc1NjcmVlblBhdGgpOiAvLCBldmVyeSBhcHAgc2NyZWVuLCB0aGUgcGFnZSBhbmQgaGFuZGxlIHNjcmVlbnMgL2EvPGlkPiwgL2EvPGlkPi9lZGl0LCAvQDxoYW5kbGU+IGFuZAojIC9APGhhbmRsZT4vPHNsdWc+LCAvbG9naW4gZm9yIGEgYnJvd3NlciB3aXRob3V0IGEgc2Vzc2lvbiAod2l0aCBvbmUsIC9sb2dpbiBzZW5kcyBpdCB0byBpdHMgc2FtZS1vcmlnaW4gY2FsbGJhY2tVcmwpLAojIGFuZCBldmVyeSBhZGRyZXNzIHRoZSBhcHAgZG9lcyBub3Qgb3RoZXJ3aXNlIHNlcnZlLCBzbyBpdCBjYW4gcm91dGUgY2xpZW50LXNpZGUuIFRoZSBhcHAga2VlcHMgdGhlIHJlc3Q6IHRoZSBBUEksCiMgL2FmLywgb2xkIGFkZHJlc3NlcywgZXZlcnkgb3RoZXIgZml4ZWQgcGF0aCAoT0F1dGggYW5kIGl0cyBjb25zZW50IHBhZ2UsIC9sbG1zLCAvd2VsY29tZSwgL3N0YXJ0LCAvbG9jYWwvY29ubmVjdCwKIyAuLi4pLCBldmVyeSBkb29yIHVuZGVyIC9hLzxpZD4vLCB0aGUgaW5zdGFsbGVkIGFwcCAvYS88aWQ+L2FwcC8gYW5kIGV4cG9ydCBjYXB0dXJlcyAoP2tleT0pOyBpdHMgb3RoZXIgc2NyZWVucyBhcmUKIyBub3QgcmVhY2hhYmxlLiBfX0NTUF9OT05DRV9fIGluc2lkZSBhbiBhdHRyaWJ1dGUgdmFsdWUgKG5vbmNlPSIuLi4iLCBhIG1ldGEgY29udGVudCkgYmVjb21lcyB0aGUgcmVzcG9uc2UncyBzY3JpcHQKIyBub25jZTsgdGhlIGZpcnN0IF9fSEVBRF9UQUdTX18gd3JpdHRlbiBhcyBtYXJrdXAgaW5zaWRlIDxoZWFkPiBiZWNvbWVzIHRoZSBhZ2VudCBwb2ludGVyIChsaW5rIHJlbD0iaGVscCIsIG1ldGEKIyBuYW1lPSJhZ2VudHMiKSwgdGhlbiBhIGRvY3VtZW50J3Mgb3duIHRpdGxlLCBkZXNjcmlwdGlvbiBhbmQgc29jaWFsIGNhcmQgd2hlcmUgYW4gYW5vbnltb3VzIHJlYWRlciBtYXkgcmVhZCBpdDsKIyBhbnkgb3RoZXIgb2NjdXJyZW5jZSAoaW4gYSBzY3JpcHQsIHN0eWxlLCBjb21tZW50LCB0ZXh0IG9yIHRoZSBib2R5KSBzdGF5cyBsaXRlcmFsLiBBbiB1bmtub3duIGFkZHJlc3MgZmV0Y2hlZAojIHdpdGhvdXQgYXNraW5nIGZvciBIVE1MIGdldHMgdGhlIEpTT04gcG9pbnRlciB0byAvbGxtcy50eHQsIG5vdCB0aGUgZmlsZS4gVW5yZWFkYWJsZTogbm8gYm9vdC4gSXRzIG93biBzY3JpcHRzIGFuZAojIHN0eWxlcyBnbyBiZXNpZGUgaXQsIG5hbWVkIHNyYz0iL2FmL3NoZWxsLzxuYW1lPi5qcyIgb3IgaHJlZj0iL2FmL3NoZWxsLzxuYW1lPi5jc3MiOiBlYWNoIGlzIHNlcnZlZCBhdCBpdHMgY29udGVudAojIGFkZHJlc3MsIGNhY2hlZCBmb3IgZ29vZCBieSBicm93c2VycyAodGhlIGZpbGUgaXRzZWxmIG5ldmVyIGlzKS4gT25lIGl0IG5hbWVzIGJ1dCB0aGF0IGlzIHVucmVhZGFibGU6IG5vIGJvb3QuCiMgQVBQX19TSEVMTF9GSUxFPS9ldGMvYXJ0aWZhY3RiaW4vc2hlbGwuaHRtbAojIFNraWxsIGV4dHJhczogYSBmbGF0IGRpcmVjdG9yeSB0aGlzIHByb2Nlc3MgY2FuIHJlYWQgd2hvc2UgLm1kIGd1aWRlcywgLm1qcyBzY3JpcHRzIGFuZCAuanNvbiBmaWxlcyB0aGUgYXV0aG9yCiMgc2tpbGwgdGhpcyBvcmlnaW4gc2VydmVzICgvc2tpbGxzL2FydGlmYWN0YmluLnppcCkgY2FycmllcyB1bmRlciBleHRyYXMvLCB3aXRoIGEgZ2VuZXJhdGVkIGV4dHJhcy9SRUFETUUubWQgaW5kZXgKIyAoZWFjaCBndWlkZSBuZWVkcyBhICIjICIgaGVhZGluZzsgYSAiUmVhZCB3aGVuIC4uLiIgbGluZSBpcyBsaXN0ZWQgdG9vKS4gVGhleSBhcmUgb3BlcmF0b3IgaW5zdHJ1Y3Rpb25zIGFuZCBjb2RlCiMgc2hpcHBlZCB0byBhZ2VudHMsIGFuZCBwdWJsaWM6IG5vIHNlY3JldHMuIE5vIGhpZGRlbiBmaWxlcywgc3ViZGlyZWN0b3JpZXMgb3Igc3ltbGlua3M7IDMyIGZpbGVzLCA2NCBLaUIgZWFjaCwKIyAyNTYgS2lCIGluIGFsbC4gQW4gaW50cm8ubWQgdGhlcmUgKHRoaXMgc2VydmVyJ3Mgb3duIGludHJvZHVjdGlvbikgYWxzbyBvcGVucyAvbGxtcy50eHQsIHZlcmJhdGltLiBSZWFkIGF0IGJvb3Q7CiMgaW52YWxpZDogbm8gYm9vdC4gRm9sbG93ZWQgd2l0aG91dCBhIHJlc3RhcnQgYWZ0ZXIgdGhhdDogdGhlIG5leHQgcmVxdWVzdCBhZnRlciBhIGZpbGUgaXMgYWRkZWQsIGNoYW5nZWQgb3IKIyByZW1vdmVkIHNlcnZlcyB0aGUgbmV3IGFyY2hpdmUgYW5kIEVUYWcgKGEgc3RhdCBvZiBlYWNoIGZpbGUgcGVyIHJlcXVlc3QsIGEgcmVyZWFkIG9ubHkgb24gY2hhbmdlKTsgYW4gaW52YWxpZAojIHN0YXRlIGtlZXBzIHRoZSBsYXN0IHZhbGlkIGZpbGVzIGFuZCBsb2dzIG9uZSBsaW5lLiBFZGl0b3Igc3dhcCBmaWxlcyAoLnguc3dwLCB4Lm1kfikgYXJlIGludmFsaWQgd2hpbGUgcHJlc2VudC4KIyBFbmFibGUgb25seSBvbmNlIGluc3RhbGxzIHJ1biBhbiB1cGRhdGVyIHRoYXQgYWNjZXB0cyBleHRyYXMvLgojIFNLSUxMU19fRVhUUkFfRElSPS9ldGMvYXJ0aWZhY3RiaW4vc2tpbGwtZXh0cmFzCiMgSW5zdGFsbGF0aW9uIGRlc2lnbiBzeXN0ZW06IGEgZmxhdCBkaXJlY3RvcnkgdGhpcyBwcm9jZXNzIGNhbiByZWFkIGhvbGRpbmcgb25lIGRlc2lnbiBzeXN0ZW0gb2YgdGhpcyBzZXJ2ZXIncwojIG93biAoYSBjb21wYW55J3MgYnJhbmQpOiBzeXN0ZW0uanNvbiwgdGhlIHJ1bnRpbWUgc3Vic2V0IG9mIGEgYnVpbHQtaW4gc3BlYyAoc2x1ZywgbmFtZSwgbW9vZCwgam9icywgY29sb3JfbW9kZSwKIyBmYW1pbGllcywgZm9udHMsIHRva2VucyB3aXRoIGxpZ2h0IGFuZCBvcHRpb25hbCBkYXJrIGNvbG91cnMsIGNvbnRyYWN0LCByYWRpdXNfY29udHJhY3QsIG9wdGlvbmFsIHJhZGl1c19zY2FsZQojIHtzbSwgbWQsIGxnLCBmdWxsfSwgZXh0cmFfdmFycywgdHlwZV9yb2xlcywgY2hhcnRfc2VyaWVzKSwgYW5kIHRoZSAud29mZjIgZmlsZXMgaXRzIGZvbnRzIG5hbWUsIG5vdGhpbmcgZWxzZS4KIyBTZXJ2ZWQgbGlrZSBhIGJ1aWx0LWluICgvYWYvc3R5bGVzLmNzcywgP3N5c3RlbT1TTFVHLCBpdHMgZm9udHMgdW5kZXIgL2FmL2ZvbnRzLywgc2VydmVyLWRyYXduIGNoYXJ0cywgZXhwb3J0cykKIyBhbmQgbGlzdGVkIGZpcnN0LCBhbmQgdGhpcyBzZXJ2ZXIncyBkZWZhdWx0IHVubGVzcyBBUFBfX0RFRkFVTFRfREVTSUdOX1NZU1RFTSBuYW1lcyBhbm90aGVyLiBUb2tlbnMgd2l0aG91dCBkYXJrCiMgdmFsdWVzIG1ha2UgaXQgbGlnaHQtb25seS4gUmVhZCBhdCBib290OyB1bmtub3duIGtleXMsIGEgbWFsZm9ybWVkIGNvbG91ciwgYSBidWlsdC1pbidzIHNsdWcsIGEgbWlzc2luZyBmb250IG9yCiMgdGhlbWUgdGV4dCBiZWxvdyBXQ0FHIEFBIGNvbnRyYXN0OiBubyBib290LiBVbnNldDogdGhlIGJ1aWx0LWluIHN5c3RlbXMgb25seSwgdW5jaGFuZ2VkLgojIEFQUF9fREVTSUdOX1NZU1RFTV9ESVI9L2V0Yy9hcnRpZmFjdGJpbi9kZXNpZ24tc3lzdGVtCiMgRGVmYXVsdCBkZXNpZ24gc3lzdGVtOiB0aGUgbmFtZSBvZiB0aGlzIHNlcnZlcidzIGRlZmF1bHQsIGEgYnVpbHQtaW4ncyAoZ3JhcGhpdGUsIG1lcmlkaWFuLCAuLi4pIG9yIHRoZQojIGluc3RhbGxhdGlvbiBzeXN0ZW0ncyBzbHVnLiAvYWYvbWFuaWZlc3QuanNvbiBuYW1lcyBpdCBhcyBkZWZhdWx0RGVzaWduU3lzdGVtLCB0aGUgYXV0aG9yIHNraWxsIG1hcmtzIGl0cyByb3cgYW5kCiMgaGFzIGFnZW50cyB1c2UgaXQgdW5sZXNzIHRoZSB1c2VyIG5hbWVzIGFub3RoZXIsIGFuZCBhIE5ldyBkb2N1bWVudCBzdGFydHMgaW4gaXQuIFVuc2V0OiB0aGUgaW5zdGFsbGF0aW9uIHN5c3RlbQojIHdoZW4gQVBQX19ERVNJR05fU1lTVEVNX0RJUiBpcyBzZXQsIGVsc2Ugbm8gZGVmYXVsdCAoZWFjaCBzdGFydGVyIGtlZXBzIGl0cyBvd24pLiBBIG5hbWUgdGhpcyBzZXJ2ZXIgZG9lcyBub3QKIyBzZXJ2ZTogbm8gYm9vdC4KIyBBUFBfX0RFRkFVTFRfREVTSUdOX1NZU1RFTT1ncmFwaGl0ZQojIEFOQUxZVElDU19fU0VDUkVUPQoKIyBTZXJ2aWNlcyB0aGF0IGFjY2VwdCB0aGlzIGluc3RhbGxhdGlvbidzIGlkZW50aXR5IHRva2VucyAoYW4gaWRlbnRpdHktc2lkZSBzZXR0aW5nOyBlbXB0eSBieSBkZWZhdWx0KTogZWFjaAojIGFuIGlkLCB0aGUgb3JpZ2luIGl0cyB0b2tlbnMgYXJlIGJvdW5kIHRvLCBhbmQgb3B0aW9uYWxseSB0aGUgU0hBLTI1NiAoaGV4KSBvZiB0aGUgc2VjcmV0IGl0IGludHJvc3BlY3RzIHdpdGgKIyAoUE9TVCAvYXBpL2ludGVybmFsL2lkZW50aXR5L2ludHJvc3BlY3QsIGFuc3dlcmluZyBpdCBvbmx5IGZvciB0b2tlbnMgb2YgaXRzIG93biBhdWRpZW5jZSkuIEEgcGVyc29uIHNpZ25zIGluCiMgZm9yIG9uZSB3aXRoIGBhdXRoLm1qcyBsb2dpbiAuLi4gLS1hdWRpZW5jZSBJRGAgKG9yIE9BdXRoIHdpdGggcmVzb3VyY2U9PG9yaWdpbj4pOyBhIHRva2VuIGZvciBpdCBpcyBuZXZlcgojIGFjY2VwdGVkIGJ5IHRoaXMgc2VydmVyJ3MgQVBJLiBBIGNhbGxlciBhbHJlYWR5IGhvbGRpbmcgYSBjcmVkZW50aWFsIGhlcmUsIGEgc2lnbmVkLWluIHBhZ2UgKHNhbWUgT3JpZ2luKSBvciBhbgojIG9yZGluYXJ5IEFQSSBiZWFyZXIsIGV4Y2hhbmdlcyBpdCBmb3IgYSA1LW1pbnV0ZSB0b2tlbiBmb3IgdGhhdCBzZXJ2aWNlLCBubyByZWZyZXNoIHRva2VuLCBlbmRpbmcgd2l0aCB0aGF0CiMgY3JlZGVudGlhbDogUE9TVCAvYXBpL2F1dGhlbnRpY2F0aW9uL3NlcnZpY2UtdG9rZW4geyJhdWRpZW5jZSI6IjxpZD4ifS4gKC9hcGkvYXV0aGVudGljYXRpb24vdG9rZW4sIHRoZSBsb25nCiMgZ3JhbnQsIHJlZnVzZXMgYW55IHJlcXVlc3QgYSBwYWdlIG1ha2VzLikgU2V0IGl0IG9uIHRoZSBhcHAgYW5kIG9uIGEgc2VwYXJhdGUgYXV0aCBob3N0IGFsaWtlLgojIEFuIGVudHJ5J3MgImFydGlmYWN0X3dvcmtsb2FkcyIga2V5IChhIHJlbW92ZWQgZmVhdHVyZSdzKSBpcyBhY2NlcHRlZCBhbmQgaWdub3JlZCwgd2l0aCBvbmUgbGluZSBhdCBib290IG5hbWluZyBpdC4KIyBJREVOVElUWV9fU0VSVklDRV9BVURJRU5DRVM9W3siaWQiOiJ3YXJlaG91c2UiLCJvcmlnaW4iOiJodHRwczovL2RhdGEuZXhhbXBsZS5jb20iLCJpbnRyb3NwZWN0aW9uX3NlY3JldF9zaGEyNTYiOiI8NjQgaGV4PiJ9XQojIE9BdXRoIGNsaWVudHMgdGhlIG9wZXJhdG9yIHJlZ2lzdGVycyAocHVibGljLCBQS0NFLCBubyBzZWNyZXQpOiBhIGZpeGVkIGlkIGFuZCByZWRpcmVjdHMgKGh0dHBzLCBvciBodHRwIG9uIGEKIyBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSwgYW5kIGEgbmFtZSBwZW9wbGUgc2VlIGF0IGNvbnNlbnQsIGUuZy4gYSBzZXJ2aWNlJ3Mgd2ViIGFwcGxpY2F0aW9uIHNpZ25pbmcgYnJvd3NlcnMgaW4KIyAocmVzb3VyY2U9PGl0cyBvcmlnaW4+LCBvciB0aGlzIEFQSSkuICJmaXJzdF9wYXJ0eSI6IHRydWUgbWFrZXMgaXQgcGFydCBvZiB0aGlzIGRlcGxveW1lbnQncyBzaWduLWluOiBubyBjb25zZW50CiMgcGFnZSwgYW5kIGl0cyBncmFudHMgZW5kIHdoZW4gdGhlIGJyb3dzZXIgc2Vzc2lvbiB0aGF0IGFwcHJvdmVkIHRoZW0gZW5kcyAoc2lnbi1vdXQpLgojIElERU5USVRZX19PQVVUSF9DTElFTlRTPVt7ImNsaWVudF9pZCI6IndhcmVob3VzZS13ZWIiLCJuYW1lIjoiV2FyZWhvdXNlIiwicmVkaXJlY3RfdXJpcyI6WyJodHRwczovL2RhdGEuZXhhbXBsZS5jb20vYXV0aC9jYWxsYmFjayJdLCJmaXJzdF9wYXJ0eSI6dHJ1ZX1dCiMgVGhlIGluc3RhbGwncyBkZWZhdWx0IGNvbm5lY3Rpb246IG9uZSBjb25uZWN0b3IgY29uZmlndXJhdGlvbiAocG9zdGdyZXMsIG15c3FsOyBzZWNyZXRzIGluY2x1ZGVkKSwgd2hpY2ggZXZlcnkKIyBzaWduZWQtaW4gcGVyc29uIG1heSBxdWVyeSByZWFkLW9ubHksIGZyb20gYSBwYWdlICg8bGluayByZWw9ImFmLWRhdGFzZXQiIGRhdGEtYWYtbmFtZT0iTkFNRSIgaHJlZj0iZGVmYXVsdDpEQiI+LAojIERCIHRoZSBkYXRhYmFzZSB0aGUgc2Vzc2lvbiBvcGVucywgYXMgd3JpdHRlbjsgU1FMIG5hbWluZyBOQU1FLnRhYmxlKSBvciBhbiBhZ2VudCAoc3FsLm1qcyBxdWVyeSBkZWZhdWx0OkRCKS4KIyBHaXZlIHRoZSBhY2NvdW50IHJlYWQtb25seSBncmFudHMuICJ0bHMiOiAidmVyaWZ5LWZ1bGwiICh0aGUgZGVmYXVsdDsgImNhIjogYSBQRU0gYnVuZGxlIGZvciBhIHByaXZhdGUgcm9vdCkgb3IKIyAiZGlzYWJsZSIuIEVhY2ggc3RhdGVtZW50IG5hbWVzIGl0cyByZWFkZXIgaW5zaWRlIGl0cyBvd24gcmVhZC1vbmx5IHRyYW5zYWN0aW9uIChhcHAudmlld2VyX2lkLCBhcHAudmlld2VyX2VtYWlsLAojIGFwcC52aWV3ZXJfZ3JvdXBzLCBhcHAudmlld2VyX2dyb3VwX3JvbGU7IE15U1FMIEBhcHAudmlld2VyXyopOiBhZHZpc29yeSBvbiBhIHBsYWluIGRhdGFiYXNlLCBzaW5jZSBhIHJlYWRlcidzIFNRTAojIGNvdWxkIGNoYW5nZSB0aGVtLiBBbiBhZ2VudCBzaWduZWQgaW4gYXMgYSBncm91cCBpcyBubyBwZXJzb246IGFwcC52aWV3ZXJfaWQgYW5kIGFwcC52aWV3ZXJfZW1haWwgYXJlIEVNUFRZLAojIGFwcC52aWV3ZXJfZ3JvdXBzIGlzIGV4YWN0bHkgaXRzIGdyb3VwIGFuZCBhcHAudmlld2VyX2dyb3VwX3JvbGUgaXRzIGxldmVsIChtZW1iZXIgb3IgZWRpdG9yOyBlbXB0eSBmb3IgYSBwZXJzb24pLgojIEEgcm93IHBvbGljeSBjb21wYXJpbmcgYSBjb2x1bW4gdG8gYXBwLnZpZXdlcl9pZCBtdXN0IG5ldmVyIHRyZWF0IHRoZSBlbXB0eSBpZCBhcyBhIG1hdGNoOiBkZWNpZGUgYSBncm91cCdzIGFnZW50CiMgYnkgYXBwLnZpZXdlcl9ncm91cHMgYW5kIGFwcC52aWV3ZXJfZ3JvdXBfcm9sZS4KIyBTaG93biBvbiB0aGUgc2V0dGluZ3MgcGFnZSB3aXRob3V0IHRoZSB1c2VyIG9yIHBhc3N3b3JkLiBJbnZhbGlkOiBubyBib290ICh0aGUgZXJyb3IgbmFtZXMgdGhpcyBzZXR0aW5nLCBuZXZlcgojIHRoZSB2YWx1ZSkuCiMgT3B0aW9uYWwgbmFtZWQgY29ubmVjdG9yczogeyJkZWZhdWx0Ijp7Li4uY29ubmVjdG9yIGNvbmZpZy4uLn0sImNvbm5lY3Rpb25zIjp7ImFuYWx5dGljcyI6ey4uLmNvbm5lY3RvciBjb25maWcuLi59fX0KIyBVc2UgZGVmYXVsdDphbmFseXRpY3M6ZGF0YWJhc2UgdG8gc2VsZWN0IGEgbmFtZWQgY29ubmVjdG9yOyBkZWZhdWx0OmRhdGFiYXNlIGtlZXBzIHRoZSBkZWZhdWx0LgojIERBVEFTRVRTX19ERUZBVUxUX0NPTk5FQ1RJT049eyJjb25uZWN0b3IiOiJwb3N0Z3JlcyIsImhvc3QiOiJkYi5leGFtcGxlLmNvbSIsImRhdGFiYXNlIjoic2hvcCIsInVzZXIiOiJyZWFkZXIiLCJwYXNzd29yZCI6Ii4uLiJ9CiMgUm91dGVzIGFjY2VwdGluZyBkYXRhYmFzZS9ncm91cCBhdCBzdGFydHVwLiBAZGVmYXVsdCBuYW1lcyB0aGUgZmFsbGJhY2suIEVtcHR5IGZvciBvcmRpbmFyeSBkYXRhYmFzZXMuCiMgREFUQVNFVFNfX0dST1VQX1NDT1BFRF9DT05ORUNUSU9OUz1AZGVmYXVsdCxhbmFseXRpY3MKIyAxIGxldHMgY29ubmVjdGlvbnMgcmVhY2ggbG9vcGJhY2sgYW5kIHByaXZhdGUgYWRkcmVzc2VzIGFuZCB0dXJuIFRMUyBvZmYgKCJ0bHMiOiJkaXNhYmxlIiksIGZvciBkZXZlbG9wbWVudCBvciBhCiMgZGF0YWJhc2Ugb24gdGhpcyBpbnN0YWxsJ3Mgb3duIG5ldHdvcms7IDAgKHRoZSBkZWZhdWx0KTogcHVibGljIGFkZHJlc3NlcyBvdmVyIHZlcmlmaWVkIFRMUyBvbmx5LiBMaW5rLWxvY2FsIGFuZAojIGNsb3VkIG1ldGFkYXRhIGFkZHJlc3NlcyBhcmUgcmVmdXNlZCBlaXRoZXIgd2F5LgojIERBVEFTRVRTX19BTExPV19QUklWQVRFX05FVFdPUks9MAojIERhdGFzZXRzIHdpdGggdGhlaXIgb3duIGRhdGFiYXNlIGNvbm5lY3Rpb24gKGxpdmUgZGF0YXNldHMpOiBvbiAodGhlIGRlZmF1bHQpIG9yIG9mZi4gT2ZmOiB0aGUgZGVmYXVsdCBjb25uZWN0aW9uCiMgaXMgdGhlIG9ubHkgd2F5IHRvIGxpdmUgZGF0YTsgY3JlYXRpbmcsIGNoYW5naW5nLCB0ZXN0aW5nLCBsaXN0aW5nIHRoZSB0YWJsZXMgb2YgYW5kIHF1ZXJ5aW5nIGEgZGF0YXNldCB3aXRoIGl0cyBvd24KIyBjb25uZWN0aW9uIGFuc3dlciBvd25fY29ubmVjdGlvbnNfb2ZmLCBhbmQgdGhlIG9uZXMgdGhhdCBleGlzdCBhcmUga2VwdCBhcyB0aGV5IGFyZSB1bnRpbCBpdCBpcyBvbiBhZ2Fpbi4KIyBEQVRBU0VUU19fT1dOX0NPTk5FQ1RJT05TPW9uCiMgT3JpZ2lucyAoaHR0cHMsIG9yIGh0dHAgb24gYSBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSBhbGxvd2VkIHRvIGZyYW1lIGEgZG9jdW1lbnQncyBhZGRyZXNzOiB0aGUgL2EvPGlkPiBhcHAKIyBwYWdlIGFuZCB0aGUgZG9jdW1lbnQgaXQgZnJhbWVzLiBPbmx5IHRoZXkgbWF5IGZyYW1lIGl0cyBlbWJlZGRlZCB2aWV3ICgvYS88aWQ+P2VtYmVkPTEsIG5vIGFwcCBiYXIpLiBXaXRoIGEKIyBjdXN0b20gc2hlbGwgKEFQUF9fU0hFTExfRklMRSkgdGhleSBtYXkgYWxzbyBmcmFtZSBpdHMgZW1iZWRkZWQgY2hhdCAoL2NvbnZlcnNhdGlvbnM/ZW1iZWQ9MSkuIEVtcHR5OiBmcmFtZWQgYnkgdGhlIGFwcCBhbG9uZS4KIyBFTUJFRF9fVFJVU1RFRF9PUklHSU5TPQojIEdyb3VwIGFwcHJvdmFsIG9mIHRoZSBhZGRyZXNzZXMgYSBwYWdlIG1heSBjYWxsOiBvbiAodGhlIGRlZmF1bHQpIG9yIG9mZi4gT24sIGEgZ3JvdXAncyBhZG1pbnMgbWF5IGFwcHJvdmUgYW4KIyBleGFjdCBodHRwcyBvcmlnaW4gYSBwYWdlIGRlY2xhcmVzIGZvciBjb25uZWN0LCBpbWcgb3IgbWVkaWEgKG5ldmVyIHNjcmlwdCwgc3R5bGUgb3IgZnJhbWUsIG5ldmVyIGEgd2lsZGNhcmQpLCBhbmQKIyBldmVyeSBtZW1iZXIgb2YgdGhlIGdyb3VwIGFuZCBpdHMgc3ViZ3JvdXBzIGlzIHRoZW4gbm90IGFza2VkIGFib3V0IGl0IG9uIGFueSBwYWdlLiBPZmY6IG5vdCBvZmZlcmVkLCB0aGUgZ3JvdXAKIyBhZGRyZXNzZXMgQVBJIGFuc3dlcnMgZ3JvdXBfYXBwcm92YWxzX2Rpc2FibGVkLCBhbmQgc3RvcmVkIGFwcHJvdmFscyBhcmUgaWdub3JlZCAoa2VwdCwgbm90IGRlbGV0ZWQpLgojIFRSVVNUX19HUk9VUF9BUFBST1ZBTFM9b24KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBPcHRpb25hbCBkaXJlY3QgZXhwb3J0IHVwbG9hZDogdGhlIGJyb3dzZXIgc2VydmljZSBQVVRzIGVhY2ggcmVuZGVyZWQgaW1hZ2UgdG8gdGhlIGFwcCdzIHNpZ25lZCBVUkwgaXRzZWxmLgojIFRoZSBleGFjdCBIVFRQUyBvcmlnaW4gdGhlIGFwcCdzIHNpZ25lciBlbWl0cywgYW5kIHRoZSBhYnNvbHV0ZSBwYXRoIGVuZGluZyBpbiAvZXhwb3J0cy9vYmplY3RzLyAocGF0aC1zdHlsZQojIHN0b3JhZ2UgcHV0cyB0aGUgYnVja2V0IGluIHRoZSBwYXRoIHRvbykuIFRoZSB1cGxvYWQgZ2F0ZXdheSBnZXRzIHRoZSBzYW1lIHR3byB2YWx1ZXMgYW5kIG5vIFMzIGNyZWRlbnRpYWxzLgojIEJST1dTRVJfX1VQTE9BRF9PUklHSU49aHR0cHM6Ly9idWNrZXQuczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20KIyBCUk9XU0VSX19VUExPQURfUFJFRklYPS9hcnRpZmFjdHMvZXhwb3J0cy9vYmplY3RzLwojIEludGVybmFsLW9ubHkgYnJvd3NlcnMgcmVhY2ggUzMgdGhyb3VnaCB0aGUgc2NvcGVkIHVwbG9hZCBnYXRld2F5IChzZXJ2aWNlcy9icm93c2VyL3NyYy91cGxvYWQtZ2F0ZXdheS1zZXJ2ZXIudHMpLAojIHdoaWNoIGpvaW5zIHRoZSBjb21wdXRlIGFuZCBlZ3Jlc3MgbmV0d29ya3MsIHB1Ymxpc2hlcyBubyBwb3J0LCBhZG1pdHMgb25seSBib3VuZGVkIFBORyBhbmQgSlBFRyBQVVRzIHRvIHRoYXQKIyBvcmlnaW4gYW5kIHByZWZpeCwgYW5kIGZvbGxvd3Mgbm8gcmVkaXJlY3QuCiMgQlJPV1NFUl9fVVBMT0FEX1BST1hZX1VSTD1odHRwOi8vdXBsb2FkLWdhdGV3YXk6ODA4MAojIEJyb3dzZXIgc2Vzc2lvbnMgcmVxdWlyZSBMaW51eCBidWJibGV3cmFwIHdpdGggdW5wcml2aWxlZ2VkIHVzZXIgbmFtZXNwYWNlcy4KIyBERVZFTE9QTUVOVCBPTkxZLiBCUk9XU0VSX19TQU5EQk9YPW5vbmUgcnVucyB0aGUgc2Vzc2lvbiB3b3JrZXIgYXMgYSBwbGFpbiBjaGlsZAojIHByb2Nlc3M6IG5vIGJ1YmJsZXdyYXAsIG5vIGNncm91cCwgTk8gT1MgY29udGFpbm1lbnQg4oCUIGEgc2Vzc2lvbiBzY3JpcHQgdGhlbiBoYXMgdGhlCiMgd2hvbGUgbWFjaGluZSwgdGhpcyBjaGVja291dCBhbmQgdGhlIG5ldHdvcmsuIEl0IGV4aXN0cyBzbyBsaXZlIHNlc3Npb25zIHJ1biBvbiBhCiMgbWFjT1MgZGV2IGhvc3QgYXQgYWxsOyBgbnBtIHJ1biBkZXZgIGFscmVhZHkgZGVmYXVsdHMgaXQgdGhlcmUuIEl0IGlzIHJlZnVzZWQgd2hlbgojIE5PREVfRU5WPXByb2R1Y3Rpb24sIGFuZCBhbnkgb3RoZXIgdmFsdWUgaXMgcmVmdXNlZCBvdXRyaWdodC4gTmV2ZXIgc2V0IGl0IG9uIGEgc2VydmVyLgojIEJST1dTRVJfX1NBTkRCT1g9bm9uZQojIEV4cG9ydHMgYW5kIGNoZWNrcyBkcmF3IGF1dGhvcnMnIHBhZ2VzIGluIHRoaXMgc2VydmljZSdzIENocm9taXVtLiBjaHJvbWl1bSBydW5zIGl0IGluIGl0cyBvd24gc2FuZGJveCAoTGludXg6IHRoZQojIGhvc3Qgb3IgY29udGFpbmVyIG11c3QgYWxsb3cgdW5wcml2aWxlZ2VkIHVzZXIgbmFtZXNwYWNlcywgU0VUVVAubWQpOyB0aGUgc2VydmljZSB0aGVuIHJlZnVzZXMgdG8gc3RhcnQgd2hlcmUgaXQKIyBjYW5ub3QuIG5vbmUgYWNjZXB0cyBydW5uaW5nIGl0IHVuc2FuZGJveGVkLiBVbnNldCBydW5zIGl0IHVuc2FuZGJveGVkIHdpdGggYSB3YXJuaW5nIGF0IGJvb3QuIEVpdGhlciB3YXkgQ2hyb21pdW0KIyBnZXRzIG5vbmUgb2YgdGhpcyBwcm9jZXNzJ3Mgc2VjcmV0cyBpbiBpdHMgZW52aXJvbm1lbnQgYW5kIHJlYWNoZXMgb25seSB0aGUgb3JpZ2lucyBhIHJlbmRlciBtYXkgbG9hZC4KIyBCUk9XU0VSX19SRU5ERVJfU0FOREJPWD1jaHJvbWl1bQojIFNwbGl0IGJyb3dzZXIgc2VydmljZTogdHJ1c3RlZCBhcHAgVVJMOyBhbHNvIHNldCBBUFBfX1BVQkxJQ19CQVNFX1VSTCwgQVBQX19QQUdFU19IT1NUIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBMaXZlIGJyb3dzZXIgc2Vzc2lvbnMgdGhpcyBzZXJ2aWNlIGhvbGRzLCBzaGFyZWQgYnkgZXZlcnkgb3duZXIsIGFuZCBob3cgbWFueSBvbmUKIyBjcmVkZW50aWFsIG1heSBob2xkLiBXaG9sZSBudW1iZXJzIG9mIGF0IGxlYXN0IDE7IGVhY2ggc2Vzc2lvbiBzdGlsbCBnZXRzIDEgR2lCLgojIEJST1dTRVJfX1NFU1NJT05fTUFYPTIKIyBCUk9XU0VSX19TRVNTSU9OX01BWF9QRVJfQUNUT1I9MgojIE9wdGlvbmFsIGhvc3QtbG9jYWwgaGFuZG9mZiBjb250cm9sLiBUaGUgc29ja2V0IGRpcmVjdG9yeSBtdXN0IGJlIHByaXZhdGUgdG8gdGhlIGJyb3dzZXIgcHJvY2Vzcy4KIyBCUk9XU0VSX19IQU5ET0ZGX1NPQ0tFVD0vdG1wL2Jyb3dzZXItaGFuZG9mZi9jb250cm9sLnNvY2sKIyBBdXRoIG93bmVyIFJQQyBvcmlnaW4gZm9yIHNwbGl0LWhvc3QgaHVtYW4gcGFnZXMgc2Vzc2lvbnMgKHByaXZhdGUgc2VydmljZSBuZXR3b3JrKS4KIyBBVVRIX19TRVJWSUNFX1VSTD1odHRwOi8vYXV0aDozMDAwCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCiMgRXZlbnRzIHVzZSB0aGUgbG9jYWwgZGF0YWJhc2UgdW5sZXNzIGFuIEhUVFAgc2VydmljZSBVUkwgaXMgY29uZmlndXJlZC4KIyBFVkVOVFNfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9ldmVudHM6ODA4MAojIEVWRU5UU19fU0NIRU1BPWV2ZW50cwpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgT3B0aW9uYWwgZGF0YWJhc2Ugc2NoZW1hIG5hbWVzLiBBVVRIX19TQ0hFTUEgYWxzbyBob2xkcyB0aGUgaWRlbnRpdHkgbW9kdWxlJ3MgdGFibGVzICh1c2VycywgdG9rZW5zLAojIGdyb3VwcyDigKYpOyBJREVOVElUWV9fU0NIRU1BIGlzIHRoZSBpZGVudGl0eSByZWFkIHZpZXdzIGV2ZXJ5IHJlYWRlciAodGhpcyBhcHAsIG90aGVyIHNlcnZpY2VzKSByZWFkcyB0aGVtIHRocm91Z2guCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAKIyBJREVOVElUWV9fU0NIRU1BPWlkZW50aXR5CgojIE9wdGlvbmFsIEdvb2dsZSBsb2dpbi4KIyBBVVRIX19HT09HTEVfQ0xJRU5UX0lEPQojIEFVVEhfX0dPT0dMRV9DTElFTlRfU0VDUkVUPQoKIyBQdWJsaWMgbmF2aWdhdGlvbiBvbiB0aGUgc3RhbmRhbG9uZSBsb2dpbiBwYWdlLiBBbiBlbXB0eSBVUkwgaGlkZXMgdGhlIGxpbmsuCiMgTE9HSU5fX1NTT19VUkw9aHR0cHM6Ly9pZGVudGl0eS5leGFtcGxlLmNvbS9zdGFydAojIExPR0lOX19TU09fTEFCRUw9U2lnbiBpbiB3aXRoIGNvbXBhbnkKCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgoKCiMgQ29tcGFueSBob3N0aW5nIHJlcXVpcmVzIGEgZGVzaWduYXRlZCB2ZXJpZmllZCBib290c3RyYXAgb3duZXIuCkFQUF9fREVQTE9ZTUVOVF9NT0RFPXB1YmxpYwpBUFBfX0RFUExPWU1FTlRfT1dORVJfRU1BSUw9CkFVVEhfX0lOVklURV9PTkxZPXRydWUKQVVUSF9fQUxMT1dFRF9FTUFJTF9QQVRURVJOUz0qCiMgVGVzdC1kb21haW4gYWNjb3VudHMgZm9yIGF1dG9tYXRlZCBydW5zICh0aGUgYWdlbnQgZXZhbHMpOiB3aXRoIGJvdGggc2V0LCBhbnkgYWRkcmVzcyBhdCBleGFjdGx5IFRFU1RfRE9NQUlOCiMgKG5vdCBhIHN1YmRvbWFpbiBvciBhIGxvb2stYWxpa2UpIHNpZ25zIGluIHdpdGggVEVTVF9ET01BSU5fT1RQIHRocm91Z2ggdGhlIG5vcm1hbCBsb2dpbiBhbmQgcmVjZWl2ZXMgbm8gbWFpbDsKIyB0aGUgY29kZSBpcyBzaW5nbGUgdXNlIHdpdGggZml2ZSBhdHRlbXB0cyBhbmQgdGhlIHVzdWFsIHJhdGUgbGltaXRzLiBOZXcgcm93cyBhcmUgbWFya2VkIHVzZXJzLnRlc3RfYWNjb3VudCBhbmQKIyBib3hlZCBpbiAoc2VydmljZXMvYXBwL2xpYi9hY2NvdW50cy90ZXN0LWFjY291bnRzLnRzKS4gRWl0aGVyIHVuc2V0ID0gb2ZmOyBhbiBpbnZhbGlkIHBhaXIgaXMgb2ZmIGFuZCBsb2dnZWQuCiMgVGhlIGlkZW50aXR5IHNlcnZpY2UgYW5kIHRoZSBhcHAgYm90aCByZWFkIHRoZSBwYWlyOiBnaXZlIGEgc3BsaXQgZGVwbG95bWVudCB0aGUgc2FtZSB2YWx1ZXMgaW4gYm90aC4KIyBURVNUX0RPTUFJTl9PVFA6IDMyLTEyOCBjaGFyYWN0ZXJzIG9mIEEtWiBhLXogMC05IC0gXyAoZS5nLiBvcGVuc3NsIHJhbmQgLWhleCAzMikuCiMgVEVTVF9ET01BSU49CiMgVEVTVF9ET01BSU5fT1RQPQoKIyBUcnVzdGVkLWlzc3VlciBzaWduLWluOiBzaXRlcyB0aGUgb3BlcmF0b3IgdHJ1c3RzIHNpZ24gYSBwZXJzb24gaW4gaGVyZSB3aXRoIGEgc2hvcnQtbGl2ZWQgRWQyNTUxOS1zaWduZWQgdG9rZW4KIyAoRWREU0EgSldULCBhdCBtb3N0IDMwMCBzLCBzaW5nbGUtdXNlIGp0aSkgdGhhdCB0aGVpciBwYWdlIHN1Ym1pdHMgYXMgYSBmb3JtIHRvIFBPU1QgL2FwaS9hdXRoL3RydXN0ZWQtc2lnbi1pbgojICh0b2tlbiwgb3B0aW9uYWwgc2FtZS1vcmlnaW4gY2FsbGJhY2tVcmwpLCBmcm9tIG9uZSBvZiB0aGUgaXNzdWVyJ3Mgb3JpZ2lucy4gc3ViIGlzIHRoZSBwZXJzb24ncyBlbWFpbCAodGhlIHNhbWUKIyBhY2NvdW50IGFuIGVtYWlsIHNpZ24taW4gcmVhY2hlcykgb3IgYSBoYW5kbGUgdGhlIGlzc3VlciBvd25zLiBFYWNoIHNpZ25lZCBncm91cHNbXSBlbnRyeSBpbmNsdWRlcyBoYW5kbGUsCiMgdGVuYW5jeV9pZCBhbmQgYSBsaXZlIHBhcmVudF9oYW5kbGVzIHBhdGggaW5zaWRlIHRoZSByZXF1aXJlZCBwYXJlbnRHcm91cCBjZWlsaW5nLiBMaXN0ZWQgZ3JvdXBzIHJlY2VpdmUKIyBvcmRpbmFyeSBtZW1iZXJzaGlwcy4gU2VlIFNFVFVQLm1kIGZvciB0aGUgdG9rZW4gZm9ybWF0IGFuZCBjb29yZGluYXRlZCB1cGdyYWRlLiBFbXB0eSBpc3N1ZXIgbGlzdCA9IG9mZi4KIyBbeyJpc3N1ZXIiOiJwYXJ0bmVyIiwiYXVkaWVuY2UiOiJ0aGlzLWFwcCIsIm9yaWdpbnMiOlsiaHR0cHM6Ly9wYXJ0bmVyLmV4YW1wbGUiXSwicHVibGljSndrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiLi4uIn0sInBhcmVudEdyb3VwIjoidGVhbSJ9XQojIFRSVVNURURfU0lHTklOX19JU1NVRVJTPQojIE9uIHRoZSBob3N0IHNlcnZpbmcgdHJ1c3RlZCBzaWduLWluLCBncmFudCB2ZXJpZmllZCBwZW9wbGUgTWVtYmVyIG9uIHRoZSBjb21wYW55IHJvb3QuCiMgQmVmb3JlIGVuYWJsaW5nLCBtb3ZlIHJlc3RyaWN0ZWQgcGFnZXMgYW5kIGdyYW50cyB0byBhIHN1Ymdyb3VwIGFuZCB2ZXJpZnkgcm9vdCBhY2Nlc3MuCiMgUmVzdGFydCB0aGUgaG9zdCB0byBiYWNrZmlsbCBhZG1pdHRlZCBwZW9wbGUgd2l0aCBhIGN1cnJlbnQgaXNzdWVyIHNlYXQgYW5kIHNpZ24taW4gZXZpZGVuY2UuCiMgSGlzdG9yaWNhbCBlbWFpbCBzaWduLWlucyB3aXRob3V0IHRoYXQgZXZpZGVuY2Ugam9pbiBvbiB0aGVpciBuZXh0IHZlcmlmaWVkIHNpZ24taW4uClRSVVNURURfU0lHTklOX19KT0lOX0NPTVBBTllfUk9PVD1mYWxzZQo=';
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
