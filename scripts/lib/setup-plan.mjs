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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAod2ViIGluZ2VzdGlvbiwgd2ViaG9va3MpLgojIENvbW1hLXNlcGFyYXRlZCBJUHY0IG9yIElQdjY7IHNlcnZlZCBhdCBHRVQgL2FwaS9vdXRib3VuZC1pcHMgc28gb3duZXJzIGtub3cgd2hhdCB0byBhbGxvdyBpbiBhIGZpcmV3YWxsLiBVbnNldCBzZXJ2ZXMgYW4gZW1wdHkgbGlzdDsgYSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX09VVEJPVU5EX0lQUz0yMDMuMC4xMTMuMTAKIyBSRVFVSVJFRC4gRXZlcnkgZG9jdW1lbnQgaXMgc2VydmVkIG9uIGl0cyBvd24gb3JpZ2luLCA8aGV4IGlkPi48dGhpcyBob3N0PiwgZnJhbWVkIGJ5IHRoZSBhcHAgcGFnZS4KIyBBIGJhcmUgaG9zdG5hbWU7IHNjaGVtZSBhbmQgcG9ydCBmb2xsb3cgQVBQX19QVUJMSUNfQkFTRV9VUkwuIFVuc2V0IHJlZnVzZXMgdGhlIGJvb3QuIE92ZXIgaHR0cHMgaXQgbWF5IGJlCiMgYSByZWdpc3RyYWJsZSBkb21haW4gb2YgaXRzIG93biAocmVjb21tZW5kZWQgaW4gcHJvZHVjdGlvbjsgdGhlIGZyYW1lJ3MgY29va2llIGlzIFNhbWVTaXRlPU5vbmU7IFBhcnRpdGlvbmVkKSwKIyB3aXRoIHdpbGRjYXJkIEROUyBhbmQgVExTIGZvciAqLjxob3N0Pi4gT3ZlciBwbGFpbiBodHRwIHRoZSBhcHAgbXVzdCBiZSBvbiB0aGUgc2FtZSBzaXRlIChTYW1lU2l0ZT1MYXgpLgojIERldmVsb3BtZW50OiBsdmgubWUsIGJyb3dzaW5nIHRoZSBhcHAgYXQgaHR0cDovL2FwcC5sdmgubWU6PHBvcnQ+IChucG0gcnVuIHNldHVwIHdyaXRlcyBib3RoKS4KQVBQX19QQUdFU19IT1NUPWx2aC5tZQpBUFBfX1BPUlQ9MzAzMAojIEFQUF9fSE9TVD0KQVBQX19ITVJfUE9SVD0KCiMgUGVyLXRva2VuIGFydGlmYWN0IGNhcDsgMCBkaXNhYmxlcyB0aGUgY2FwLgpRVU9UQV9fQVJUSUZBQ1RTX1BFUl9UT0tFTj0xMDAwCgojIFN0b3JlZCBhc3NldHMgcGVyIGFjY291bnQgKHVwbG9hZHMgKyBVUkxzIGltcG9ydGVkIGZpcnN0KSwgMTAgR0I7IGFub255bW91cyB0b2tlbnMgaGF2ZSB0aGVpciBvd24gY2FwLiAwIGRpc2FibGVzLgojIEFTU0VUU19fTUFYX0JZVEVTX1BFUl9UT0tFTj0xMDAwMDAwMDAwMAoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZW1haWwtY29kZSBsb2dpbiB1c2VzIGVpdGhlciBTTVRQIG9yIFJlc2VuZCB3aXRoIGFuIGF1dGhvcml6ZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CiMgU01UUCBhbHRlcm5hdGl2ZTogZGVmYXVsdCBwb3J0IDU4NyByZXF1aXJlcyBTVEFSVFRMUzsgc2VjdXJlPXRydWUgdXNlcyBpbXBsaWNpdCBUTFMgKGRlZmF1bHQgNDY1KS4KRU1BSUxfX1NNVFBfSE9TVD0KRU1BSUxfX1NNVFBfUE9SVD0KRU1BSUxfX1NNVFBfU0VDVVJFPQpFTUFJTF9fU01UUF9VU0VSPQpFTUFJTF9fU01UUF9QQVNTV09SRD0KRU1BSUxfX0ZST009YXJ0aWZhY3RiaW4gPGxvZ2luQGV4YW1wbGUuY29tPgojIFRoZSBwcm9kdWN0IG5hbWUgc2lnbi1pbiBtYWlsIG5hbWVzIChzdWJqZWN0IGFuZCBib2R5KSwgZm9yIGFuIGluc3RhbGwgcHJlc2VudGVkIHVuZGVyIGFub3RoZXIgbmFtZTsgcGxhaW4gdGV4dCwgb25lCiMgbGluZSwgYXQgbW9zdCA2MCBjaGFyYWN0ZXJzLiBVbnNldDogYXJ0aWZhY3RiaW4uIEludmFsaWQ6IG5vIGJvb3QuCiMgQVBQX19OQU1FPUFjbWUgRGF0YQoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMDAKUERGX19NQVhfQllURVM9NTAwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKCiMgTW9zdCByb3dzIGEgZGF0YXNldCBrZWVwcyBhbmQgb25lIHF1ZXJ5IHJlc3VsdCBjYXJyaWVzLgpTUUxfX01BWF9ST1dTPTEwMDAwCiMgUmVhZCBleGVjdXRpb24gY2FwIChwb3NpdGl2ZSBpbnRlZ2VyLCBtYXhpbXVtIDEyMDAwMCk7IHdob2xlIHJlYWQgYWxsb3dzIDE1MDAwbXMgb3ZlcmhlYWQuCiMgTGVhdmUgdW5zZXQgZm9yIHRoZSAzMDAwMG1zIGRlZmF1bHQuIERhdGFzZXQgd3JpdGVzIGFsd2F5cyBnZXQgNTAwMG1zLgojIFNRTF9fUVVFUllfVElNRU9VVF9NUz0zMDAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgaW4gZnJvbnQgb2YgdGhpcyBhcHA6IHRoZXkgc2V0IFgtRm9yd2FyZGVkLUZvci8tSG9zdC8tUHJvdG8sIHJlYWQgdGhhdCBtYW55CiMgZW50cmllcyBmcm9tIHRoZSBlbmQuIDA6IG5vIHByb3h5LCBzbyB0aG9zZSBoZWFkZXJzIGFyZSBpZ25vcmVkIGFuZCBIb3N0IGlzIHRoZSBhZGRyZXNzZWQgaG9zdCAoYW5vbnltb3VzCiMgcmVhZGVycyB0aGVuIHNoYXJlIG9uZSByYXRlLWxpbWl0IGJ1Y2tldDogbm8gYWRkcmVzcyBpZGVudGlmaWVzIHRoZW0pLgpIVFRQX19UUlVTVEVEX1BST1hZX0hPUFM9MQoKIyBPcHRpb25hbCBkZXBsb3ltZW50IGNvbnRyb2xzLgojIEFSVElGQUNUU19fQUxMT1dfUFVCTElDPTEKIyBBbm9ueW1vdXMgdXNlci9ncm91cCBwdWJsaXNoaW5nIGhvc3RzLiBPZmYgYnkgZGVmYXVsdDsgYSBiYXJlIGhvc3RuYW1lLiBFYWNoIGxpdmUgdXNlciBvciBncm91cCBoYW5kbGUKIyAodW5kZXJzY29yZXMgYmVjb21lIGh5cGhlbnMpIGdldHMgPGhhbmRsZT4uPHRoaXMgaG9zdD46IHB1YmxpYyBIVE1MIG9uIGl0cyBob21lLCB1bmxpc3RlZCBieSBJRCBvbmx5IChub2luZGV4LAojIG5vLXJlZmVycmVyKS4gRXZlcnkgcmVxdWVzdCB0aGVyZSBpcyBhIGd1ZXN0J3MsIGNvb2tpZXMgb3Igbm90OiBzcWwgcmVhZHMgb25seS4KIyBXaWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgaXQgYXJlIHRoZSBvcGVyYXRvcidzOyB0aGUgcHJvZHVjdCBuZXZlciBwcm92aXNpb25zIGEgaG9zdG5hbWUuCiMgQVBQX19VU0VSX1BBR0VTX0hPU1Q9dS5leGFtcGxlLmNvbQojIEEgY3VzdG9tIHNoZWxsOiBvbmUgSFRNTCBmaWxlIHRoaXMgcHJvY2VzcyBjYW4gcmVhZCwgc2VydmVkICgyMDAsIG5vLXN0b3JlLCB0aGUgYXBwJ3MgQ1NQLCBhIExpbmsgcmVsPSJoZWxwIiB0bwojIC9sbG1zLnR4dCkgaW4gcGxhY2Ugb2YgdGhlIGFwcCdzIG93biBzY3JlZW5zOiBleGFjdGx5IHRoZSBhZGRyZXNzZXMgdGhlIFVSTCBtYXAgY2FsbHMgc2NyZWVucyAoL2FmL3VybC1zcGFjZS5qc29uLAojIGNvbnRyYWN0cyBpc1NjcmVlblBhdGgpOiAvLCBldmVyeSBhcHAgc2NyZWVuLCB0aGUgcGFnZSBhbmQgaGFuZGxlIHNjcmVlbnMgL2EvPGlkPiwgL2EvPGlkPi9lZGl0LCAvQDxoYW5kbGU+IGFuZAojIC9APGhhbmRsZT4vPHNsdWc+LCAvbG9naW4gZm9yIGEgYnJvd3NlciB3aXRob3V0IGEgc2Vzc2lvbiAod2l0aCBvbmUsIC9sb2dpbiBzZW5kcyBpdCB0byBpdHMgc2FtZS1vcmlnaW4gY2FsbGJhY2tVcmwpLAojIGFuZCBldmVyeSBhZGRyZXNzIHRoZSBhcHAgZG9lcyBub3Qgb3RoZXJ3aXNlIHNlcnZlLCBzbyBpdCBjYW4gcm91dGUgY2xpZW50LXNpZGUuIFRoZSBhcHAga2VlcHMgdGhlIHJlc3Q6IHRoZSBBUEksCiMgL2FmLywgb2xkIGFkZHJlc3NlcywgZXZlcnkgb3RoZXIgZml4ZWQgcGF0aCAoT0F1dGggYW5kIGl0cyBjb25zZW50IHBhZ2UsIC9sbG1zLCAvd2VsY29tZSwgL3N0YXJ0LCAvbG9jYWwvY29ubmVjdCwKIyAuLi4pLCBldmVyeSBkb29yIHVuZGVyIC9hLzxpZD4vLCB0aGUgaW5zdGFsbGVkIGFwcCAvYS88aWQ+L2FwcC8gYW5kIGV4cG9ydCBjYXB0dXJlcyAoP2tleT0pOyBpdHMgb3RoZXIgc2NyZWVucyBhcmUKIyBub3QgcmVhY2hhYmxlLiBfX0NTUF9OT05DRV9fIGluc2lkZSBhbiBhdHRyaWJ1dGUgdmFsdWUgKG5vbmNlPSIuLi4iLCBhIG1ldGEgY29udGVudCkgYmVjb21lcyB0aGUgcmVzcG9uc2UncyBzY3JpcHQKIyBub25jZTsgdGhlIGZpcnN0IF9fSEVBRF9UQUdTX18gd3JpdHRlbiBhcyBtYXJrdXAgaW5zaWRlIDxoZWFkPiBiZWNvbWVzIHRoZSBhZ2VudCBwb2ludGVyIChsaW5rIHJlbD0iaGVscCIsIG1ldGEKIyBuYW1lPSJhZ2VudHMiKSwgdGhlbiBhIGRvY3VtZW50J3Mgb3duIHRpdGxlLCBkZXNjcmlwdGlvbiBhbmQgc29jaWFsIGNhcmQgd2hlcmUgYW4gYW5vbnltb3VzIHJlYWRlciBtYXkgcmVhZCBpdDsKIyBhbnkgb3RoZXIgb2NjdXJyZW5jZSAoaW4gYSBzY3JpcHQsIHN0eWxlLCBjb21tZW50LCB0ZXh0IG9yIHRoZSBib2R5KSBzdGF5cyBsaXRlcmFsLiBBbiB1bmtub3duIGFkZHJlc3MgZmV0Y2hlZAojIHdpdGhvdXQgYXNraW5nIGZvciBIVE1MIGdldHMgdGhlIEpTT04gcG9pbnRlciB0byAvbGxtcy50eHQsIG5vdCB0aGUgZmlsZS4gVW5yZWFkYWJsZTogbm8gYm9vdC4KIyBBUFBfX1NIRUxMX0ZJTEU9L2V0Yy9hcnRpZmFjdGJpbi9zaGVsbC5odG1sCiMgU2tpbGwgZXh0cmFzOiBhIGZsYXQgZGlyZWN0b3J5IHRoaXMgcHJvY2VzcyBjYW4gcmVhZCB3aG9zZSAubWQgZ3VpZGVzLCAubWpzIHNjcmlwdHMgYW5kIC5qc29uIGZpbGVzIHRoZSBhdXRob3IKIyBza2lsbCB0aGlzIG9yaWdpbiBzZXJ2ZXMgKC9za2lsbHMvYXJ0aWZhY3RiaW4uemlwKSBjYXJyaWVzIHVuZGVyIGV4dHJhcy8sIHdpdGggYSBnZW5lcmF0ZWQgZXh0cmFzL1JFQURNRS5tZCBpbmRleAojIChlYWNoIGd1aWRlIG5lZWRzIGEgIiMgIiBoZWFkaW5nOyBhICJSZWFkIHdoZW4gLi4uIiBsaW5lIGlzIGxpc3RlZCB0b28pLiBUaGV5IGFyZSBvcGVyYXRvciBpbnN0cnVjdGlvbnMgYW5kIGNvZGUKIyBzaGlwcGVkIHRvIGFnZW50cywgYW5kIHB1YmxpYzogbm8gc2VjcmV0cy4gTm8gaGlkZGVuIGZpbGVzLCBzdWJkaXJlY3RvcmllcyBvciBzeW1saW5rczsgMzIgZmlsZXMsIDY0IEtpQiBlYWNoLAojIDI1NiBLaUIgaW4gYWxsLiBBbiBpbnRyby5tZCB0aGVyZSAodGhpcyBzZXJ2ZXIncyBvd24gaW50cm9kdWN0aW9uKSBhbHNvIG9wZW5zIC9sbG1zLnR4dCwgdmVyYmF0aW0uIFJlYWQgYXQgYm9vdDsKIyBpbnZhbGlkOiBubyBib290LiBGb2xsb3dlZCB3aXRob3V0IGEgcmVzdGFydCBhZnRlciB0aGF0OiB0aGUgbmV4dCByZXF1ZXN0IGFmdGVyIGEgZmlsZSBpcyBhZGRlZCwgY2hhbmdlZCBvcgojIHJlbW92ZWQgc2VydmVzIHRoZSBuZXcgYXJjaGl2ZSBhbmQgRVRhZyAoYSBzdGF0IG9mIGVhY2ggZmlsZSBwZXIgcmVxdWVzdCwgYSByZXJlYWQgb25seSBvbiBjaGFuZ2UpOyBhbiBpbnZhbGlkCiMgc3RhdGUga2VlcHMgdGhlIGxhc3QgdmFsaWQgZmlsZXMgYW5kIGxvZ3Mgb25lIGxpbmUuIEVkaXRvciBzd2FwIGZpbGVzICgueC5zd3AsIHgubWR+KSBhcmUgaW52YWxpZCB3aGlsZSBwcmVzZW50LgojIEVuYWJsZSBvbmx5IG9uY2UgaW5zdGFsbHMgcnVuIGFuIHVwZGF0ZXIgdGhhdCBhY2NlcHRzIGV4dHJhcy8uCiMgU0tJTExTX19FWFRSQV9ESVI9L2V0Yy9hcnRpZmFjdGJpbi9za2lsbC1leHRyYXMKIyBBTkFMWVRJQ1NfX1NFQ1JFVD0KCiMgU2VydmljZXMgdGhhdCBhY2NlcHQgdGhpcyBpbnN0YWxsYXRpb24ncyBpZGVudGl0eSB0b2tlbnMgKGFuIGlkZW50aXR5LXNpZGUgc2V0dGluZzsgZW1wdHkgYnkgZGVmYXVsdCk6IGVhY2gKIyBhbiBpZCwgdGhlIG9yaWdpbiBpdHMgdG9rZW5zIGFyZSBib3VuZCB0bywgYW5kIG9wdGlvbmFsbHkgdGhlIFNIQS0yNTYgKGhleCkgb2YgdGhlIHNlY3JldCBpdCBpbnRyb3NwZWN0cyB3aXRoCiMgKFBPU1QgL2FwaS9pbnRlcm5hbC9pZGVudGl0eS9pbnRyb3NwZWN0LCBhbnN3ZXJpbmcgaXQgb25seSBmb3IgdG9rZW5zIG9mIGl0cyBvd24gYXVkaWVuY2UpLiBBIHBlcnNvbiBzaWducyBpbgojIGZvciBvbmUgd2l0aCBgYXV0aC5tanMgbG9naW4gLi4uIC0tYXVkaWVuY2UgSURgIChvciBPQXV0aCB3aXRoIHJlc291cmNlPTxvcmlnaW4+KTsgYSB0b2tlbiBmb3IgaXQgaXMgbmV2ZXIKIyBhY2NlcHRlZCBieSB0aGlzIHNlcnZlcidzIEFQSS4gQSBjYWxsZXIgYWxyZWFkeSBob2xkaW5nIGEgY3JlZGVudGlhbCBoZXJlLCBhIHNpZ25lZC1pbiBwYWdlIChzYW1lIE9yaWdpbikgb3IgYW4KIyBvcmRpbmFyeSBBUEkgYmVhcmVyLCBleGNoYW5nZXMgaXQgZm9yIGEgNS1taW51dGUgdG9rZW4gZm9yIHRoYXQgc2VydmljZSwgbm8gcmVmcmVzaCB0b2tlbiwgZW5kaW5nIHdpdGggdGhhdAojIGNyZWRlbnRpYWw6IFBPU1QgL2FwaS9hdXRoZW50aWNhdGlvbi9zZXJ2aWNlLXRva2VuIHsiYXVkaWVuY2UiOiI8aWQ+In0uICgvYXBpL2F1dGhlbnRpY2F0aW9uL3Rva2VuLCB0aGUgbG9uZwojIGdyYW50LCByZWZ1c2VzIGFueSByZXF1ZXN0IGEgcGFnZSBtYWtlcy4pIFNldCBpdCBvbiB0aGUgYXBwIGFuZCBvbiBhIHNlcGFyYXRlIGF1dGggaG9zdCBhbGlrZS4KIyBBbiBlbnRyeSdzICJhcnRpZmFjdF93b3JrbG9hZHMiIGtleSAoYSByZW1vdmVkIGZlYXR1cmUncykgaXMgYWNjZXB0ZWQgYW5kIGlnbm9yZWQsIHdpdGggb25lIGxpbmUgYXQgYm9vdCBuYW1pbmcgaXQuCiMgSURFTlRJVFlfX1NFUlZJQ0VfQVVESUVOQ0VTPVt7ImlkIjoid2FyZWhvdXNlIiwib3JpZ2luIjoiaHR0cHM6Ly9kYXRhLmV4YW1wbGUuY29tIiwiaW50cm9zcGVjdGlvbl9zZWNyZXRfc2hhMjU2IjoiPDY0IGhleD4ifV0KIyBPQXV0aCBjbGllbnRzIHRoZSBvcGVyYXRvciByZWdpc3RlcnMgKHB1YmxpYywgUEtDRSwgbm8gc2VjcmV0KTogYSBmaXhlZCBpZCBhbmQgcmVkaXJlY3RzIChodHRwcywgb3IgaHR0cCBvbiBhCiMgbG9jYWwgZGV2ZWxvcG1lbnQgaG9zdCksIGFuZCBhIG5hbWUgcGVvcGxlIHNlZSBhdCBjb25zZW50LCBlLmcuIGEgc2VydmljZSdzIHdlYiBhcHBsaWNhdGlvbiBzaWduaW5nIGJyb3dzZXJzIGluCiMgKHJlc291cmNlPTxpdHMgb3JpZ2luPiwgb3IgdGhpcyBBUEkpLiAiZmlyc3RfcGFydHkiOiB0cnVlIG1ha2VzIGl0IHBhcnQgb2YgdGhpcyBkZXBsb3ltZW50J3Mgc2lnbi1pbjogbm8gY29uc2VudAojIHBhZ2UsIGFuZCBpdHMgZ3JhbnRzIGVuZCB3aGVuIHRoZSBicm93c2VyIHNlc3Npb24gdGhhdCBhcHByb3ZlZCB0aGVtIGVuZHMgKHNpZ24tb3V0KS4KIyBJREVOVElUWV9fT0FVVEhfQ0xJRU5UUz1beyJjbGllbnRfaWQiOiJ3YXJlaG91c2Utd2ViIiwibmFtZSI6IldhcmVob3VzZSIsInJlZGlyZWN0X3VyaXMiOlsiaHR0cHM6Ly9kYXRhLmV4YW1wbGUuY29tL2F1dGgvY2FsbGJhY2siXSwiZmlyc3RfcGFydHkiOnRydWV9XQojIFRoZSBpbnN0YWxsJ3MgZGVmYXVsdCBjb25uZWN0aW9uOiBvbmUgY29ubmVjdG9yIGNvbmZpZ3VyYXRpb24gKHBvc3RncmVzLCBteXNxbDsgc2VjcmV0cyBpbmNsdWRlZCksIHdoaWNoIGV2ZXJ5CiMgc2lnbmVkLWluIHBlcnNvbiBtYXkgcXVlcnkgcmVhZC1vbmx5LCBmcm9tIGEgcGFnZSAoPGxpbmsgcmVsPSJhZi1kYXRhc2V0IiBkYXRhLWFmLW5hbWU9Ik5BTUUiIGhyZWY9ImRlZmF1bHQ6REIiPiwKIyBEQiB0aGUgZGF0YWJhc2UgdGhlIHNlc3Npb24gb3BlbnMsIGFzIHdyaXR0ZW47IFNRTCBuYW1pbmcgTkFNRS50YWJsZSkgb3IgYW4gYWdlbnQgKHNxbC5tanMgcXVlcnkgZGVmYXVsdDpEQikuCiMgR2l2ZSB0aGUgYWNjb3VudCByZWFkLW9ubHkgZ3JhbnRzLiAidGxzIjogInZlcmlmeS1mdWxsIiAodGhlIGRlZmF1bHQ7ICJjYSI6IGEgUEVNIGJ1bmRsZSBmb3IgYSBwcml2YXRlIHJvb3QpIG9yCiMgImRpc2FibGUiLiBFYWNoIHN0YXRlbWVudCBuYW1lcyBpdHMgcmVhZGVyIGluc2lkZSBpdHMgb3duIHJlYWQtb25seSB0cmFuc2FjdGlvbiAoYXBwLnZpZXdlcl9pZCwgYXBwLnZpZXdlcl9lbWFpbCwKIyBhcHAudmlld2VyX2dyb3VwcywgYXBwLnZpZXdlcl9ncm91cF9yb2xlOyBNeVNRTCBAYXBwLnZpZXdlcl8qKTogYWR2aXNvcnkgb24gYSBwbGFpbiBkYXRhYmFzZSwgc2luY2UgYSByZWFkZXIncyBTUUwKIyBjb3VsZCBjaGFuZ2UgdGhlbS4gQW4gYWdlbnQgc2lnbmVkIGluIGFzIGEgZ3JvdXAgaXMgbm8gcGVyc29uOiBhcHAudmlld2VyX2lkIGFuZCBhcHAudmlld2VyX2VtYWlsIGFyZSBFTVBUWSwKIyBhcHAudmlld2VyX2dyb3VwcyBpcyBleGFjdGx5IGl0cyBncm91cCBhbmQgYXBwLnZpZXdlcl9ncm91cF9yb2xlIGl0cyBsZXZlbCAobWVtYmVyIG9yIGVkaXRvcjsgZW1wdHkgZm9yIGEgcGVyc29uKS4KIyBBIHJvdyBwb2xpY3kgY29tcGFyaW5nIGEgY29sdW1uIHRvIGFwcC52aWV3ZXJfaWQgbXVzdCBuZXZlciB0cmVhdCB0aGUgZW1wdHkgaWQgYXMgYSBtYXRjaDogZGVjaWRlIGEgZ3JvdXAncyBhZ2VudAojIGJ5IGFwcC52aWV3ZXJfZ3JvdXBzIGFuZCBhcHAudmlld2VyX2dyb3VwX3JvbGUuCiMgU2hvd24gb24gdGhlIHNldHRpbmdzIHBhZ2Ugd2l0aG91dCB0aGUgdXNlciBvciBwYXNzd29yZC4gSW52YWxpZDogbm8gYm9vdCAodGhlIGVycm9yIG5hbWVzIHRoaXMgc2V0dGluZywgbmV2ZXIKIyB0aGUgdmFsdWUpLgojIE9wdGlvbmFsIG5hbWVkIGNvbm5lY3RvcnM6IHsiZGVmYXVsdCI6ey4uLmNvbm5lY3RvciBjb25maWcuLi59LCJjb25uZWN0aW9ucyI6eyJhbmFseXRpY3MiOnsuLi5jb25uZWN0b3IgY29uZmlnLi4ufX19CiMgVXNlIGRlZmF1bHQ6YW5hbHl0aWNzOmRhdGFiYXNlIHRvIHNlbGVjdCBhIG5hbWVkIGNvbm5lY3RvcjsgZGVmYXVsdDpkYXRhYmFzZSBrZWVwcyB0aGUgZGVmYXVsdC4KIyBEQVRBU0VUU19fREVGQVVMVF9DT05ORUNUSU9OPXsiY29ubmVjdG9yIjoicG9zdGdyZXMiLCJob3N0IjoiZGIuZXhhbXBsZS5jb20iLCJkYXRhYmFzZSI6InNob3AiLCJ1c2VyIjoicmVhZGVyIiwicGFzc3dvcmQiOiIuLi4ifQojIDEgbGV0cyBjb25uZWN0aW9ucyByZWFjaCBsb29wYmFjayBhbmQgcHJpdmF0ZSBhZGRyZXNzZXMgYW5kIHR1cm4gVExTIG9mZiAoInRscyI6ImRpc2FibGUiKSwgZm9yIGRldmVsb3BtZW50IG9yIGEKIyBkYXRhYmFzZSBvbiB0aGlzIGluc3RhbGwncyBvd24gbmV0d29yazsgMCAodGhlIGRlZmF1bHQpOiBwdWJsaWMgYWRkcmVzc2VzIG92ZXIgdmVyaWZpZWQgVExTIG9ubHkuIExpbmstbG9jYWwgYW5kCiMgY2xvdWQgbWV0YWRhdGEgYWRkcmVzc2VzIGFyZSByZWZ1c2VkIGVpdGhlciB3YXkuCiMgREFUQVNFVFNfX0FMTE9XX1BSSVZBVEVfTkVUV09SSz0wCiMgRGF0YXNldHMgd2l0aCB0aGVpciBvd24gZGF0YWJhc2UgY29ubmVjdGlvbiAobGl2ZSBkYXRhc2V0cyk6IG9uICh0aGUgZGVmYXVsdCkgb3Igb2ZmLiBPZmY6IHRoZSBkZWZhdWx0IGNvbm5lY3Rpb24KIyBpcyB0aGUgb25seSB3YXkgdG8gbGl2ZSBkYXRhOyBjcmVhdGluZywgY2hhbmdpbmcsIHRlc3RpbmcsIGxpc3RpbmcgdGhlIHRhYmxlcyBvZiBhbmQgcXVlcnlpbmcgYSBkYXRhc2V0IHdpdGggaXRzIG93bgojIGNvbm5lY3Rpb24gYW5zd2VyIG93bl9jb25uZWN0aW9uc19vZmYsIGFuZCB0aGUgb25lcyB0aGF0IGV4aXN0IGFyZSBrZXB0IGFzIHRoZXkgYXJlIHVudGlsIGl0IGlzIG9uIGFnYWluLgojIERBVEFTRVRTX19PV05fQ09OTkVDVElPTlM9b24KIyBPcmlnaW5zIChodHRwcywgb3IgaHR0cCBvbiBhIGxvY2FsIGRldmVsb3BtZW50IGhvc3QpIGFsbG93ZWQgdG8gZnJhbWUgYSBkb2N1bWVudCdzIGFkZHJlc3M6IHRoZSAvYS88aWQ+IGFwcAojIHBhZ2UgYW5kIHRoZSBkb2N1bWVudCBpdCBmcmFtZXMuIE9ubHkgdGhleSBtYXkgZnJhbWUgaXRzIGVtYmVkZGVkIHZpZXcgKC9hLzxpZD4/ZW1iZWQ9MSwgbm8gYXBwIGJhcikuIFdpdGggYQojIGN1c3RvbSBzaGVsbCAoQVBQX19TSEVMTF9GSUxFKSB0aGV5IG1heSBhbHNvIGZyYW1lIGl0cyBlbWJlZGRlZCBjaGF0ICgvY29udmVyc2F0aW9ucz9lbWJlZD0xKS4gRW1wdHk6IGZyYW1lZCBieSB0aGUgYXBwIGFsb25lLgojIEVNQkVEX19UUlVTVEVEX09SSUdJTlM9CiMgR3JvdXAgYXBwcm92YWwgb2YgdGhlIGFkZHJlc3NlcyBhIHBhZ2UgbWF5IGNhbGw6IG9uICh0aGUgZGVmYXVsdCkgb3Igb2ZmLiBPbiwgYSBncm91cCdzIGFkbWlucyBtYXkgYXBwcm92ZSBhbgojIGV4YWN0IGh0dHBzIG9yaWdpbiBhIHBhZ2UgZGVjbGFyZXMgZm9yIGNvbm5lY3QsIGltZyBvciBtZWRpYSAobmV2ZXIgc2NyaXB0LCBzdHlsZSBvciBmcmFtZSwgbmV2ZXIgYSB3aWxkY2FyZCksIGFuZAojIGV2ZXJ5IG1lbWJlciBvZiB0aGUgZ3JvdXAgYW5kIGl0cyBzdWJncm91cHMgaXMgdGhlbiBub3QgYXNrZWQgYWJvdXQgaXQgb24gYW55IHBhZ2UuIE9mZjogbm90IG9mZmVyZWQsIHRoZSBncm91cAojIGFkZHJlc3NlcyBBUEkgYW5zd2VycyBncm91cF9hcHByb3ZhbHNfZGlzYWJsZWQsIGFuZCBzdG9yZWQgYXBwcm92YWxzIGFyZSBpZ25vcmVkIChrZXB0LCBub3QgZGVsZXRlZCkuCiMgVFJVU1RfX0dST1VQX0FQUFJPVkFMUz1vbgoKIyBTcGxpdC1zZXJ2aWNlIGRlcGxveW1lbnQuIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVCBtdXN0IG1hdGNoIGFjcm9zcyBhcHAsIFNRTCwgYnJvd3NlciBhbmQgZXZlbnRzLgojIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQ9CiMgQlJPV1NFUl9fU0VSVklDRV9VUkw9aHR0cDovL2Jyb3dzZXI6ODA4MAojIE9wdGlvbmFsIGRpcmVjdCBleHBvcnQgdXBsb2FkOiB0aGUgYnJvd3NlciBzZXJ2aWNlIFBVVHMgZWFjaCByZW5kZXJlZCBpbWFnZSB0byB0aGUgYXBwJ3Mgc2lnbmVkIFVSTCBpdHNlbGYuCiMgVGhlIGV4YWN0IEhUVFBTIG9yaWdpbiB0aGUgYXBwJ3Mgc2lnbmVyIGVtaXRzLCBhbmQgdGhlIGFic29sdXRlIHBhdGggZW5kaW5nIGluIC9leHBvcnRzL29iamVjdHMvIChwYXRoLXN0eWxlCiMgc3RvcmFnZSBwdXRzIHRoZSBidWNrZXQgaW4gdGhlIHBhdGggdG9vKS4gVGhlIHVwbG9hZCBnYXRld2F5IGdldHMgdGhlIHNhbWUgdHdvIHZhbHVlcyBhbmQgbm8gUzMgY3JlZGVudGlhbHMuCiMgQlJPV1NFUl9fVVBMT0FEX09SSUdJTj1odHRwczovL2J1Y2tldC5zMy51cy13ZXN0LTEuYW1hem9uYXdzLmNvbQojIEJST1dTRVJfX1VQTE9BRF9QUkVGSVg9L2FydGlmYWN0cy9leHBvcnRzL29iamVjdHMvCiMgSW50ZXJuYWwtb25seSBicm93c2VycyByZWFjaCBTMyB0aHJvdWdoIHRoZSBzY29wZWQgdXBsb2FkIGdhdGV3YXkgKHNlcnZpY2VzL2Jyb3dzZXIvc3JjL3VwbG9hZC1nYXRld2F5LXNlcnZlci50cyksCiMgd2hpY2ggam9pbnMgdGhlIGNvbXB1dGUgYW5kIGVncmVzcyBuZXR3b3JrcywgcHVibGlzaGVzIG5vIHBvcnQsIGFkbWl0cyBvbmx5IGJvdW5kZWQgUE5HIGFuZCBKUEVHIFBVVHMgdG8gdGhhdAojIG9yaWdpbiBhbmQgcHJlZml4LCBhbmQgZm9sbG93cyBubyByZWRpcmVjdC4KIyBCUk9XU0VSX19VUExPQURfUFJPWFlfVVJMPWh0dHA6Ly91cGxvYWQtZ2F0ZXdheTo4MDgwCiMgQnJvd3NlciBzZXNzaW9ucyByZXF1aXJlIExpbnV4IGJ1YmJsZXdyYXAgd2l0aCB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLgojIERFVkVMT1BNRU5UIE9OTFkuIEJST1dTRVJfX1NBTkRCT1g9bm9uZSBydW5zIHRoZSBzZXNzaW9uIHdvcmtlciBhcyBhIHBsYWluIGNoaWxkCiMgcHJvY2Vzczogbm8gYnViYmxld3JhcCwgbm8gY2dyb3VwLCBOTyBPUyBjb250YWlubWVudCDigJQgYSBzZXNzaW9uIHNjcmlwdCB0aGVuIGhhcyB0aGUKIyB3aG9sZSBtYWNoaW5lLCB0aGlzIGNoZWNrb3V0IGFuZCB0aGUgbmV0d29yay4gSXQgZXhpc3RzIHNvIGxpdmUgc2Vzc2lvbnMgcnVuIG9uIGEKIyBtYWNPUyBkZXYgaG9zdCBhdCBhbGw7IGBucG0gcnVuIGRldmAgYWxyZWFkeSBkZWZhdWx0cyBpdCB0aGVyZS4gSXQgaXMgcmVmdXNlZCB3aGVuCiMgTk9ERV9FTlY9cHJvZHVjdGlvbiwgYW5kIGFueSBvdGhlciB2YWx1ZSBpcyByZWZ1c2VkIG91dHJpZ2h0LiBOZXZlciBzZXQgaXQgb24gYSBzZXJ2ZXIuCiMgQlJPV1NFUl9fU0FOREJPWD1ub25lCiMgRXhwb3J0cyBhbmQgY2hlY2tzIGRyYXcgYXV0aG9ycycgcGFnZXMgaW4gdGhpcyBzZXJ2aWNlJ3MgQ2hyb21pdW0uIGNocm9taXVtIHJ1bnMgaXQgaW4gaXRzIG93biBzYW5kYm94IChMaW51eDogdGhlCiMgaG9zdCBvciBjb250YWluZXIgbXVzdCBhbGxvdyB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLCBTRVRVUC5tZCk7IHRoZSBzZXJ2aWNlIHRoZW4gcmVmdXNlcyB0byBzdGFydCB3aGVyZSBpdAojIGNhbm5vdC4gbm9uZSBhY2NlcHRzIHJ1bm5pbmcgaXQgdW5zYW5kYm94ZWQuIFVuc2V0IHJ1bnMgaXQgdW5zYW5kYm94ZWQgd2l0aCBhIHdhcm5pbmcgYXQgYm9vdC4gRWl0aGVyIHdheSBDaHJvbWl1bQojIGdldHMgbm9uZSBvZiB0aGlzIHByb2Nlc3MncyBzZWNyZXRzIGluIGl0cyBlbnZpcm9ubWVudCBhbmQgcmVhY2hlcyBvbmx5IHRoZSBvcmlnaW5zIGEgcmVuZGVyIG1heSBsb2FkLgojIEJST1dTRVJfX1JFTkRFUl9TQU5EQk9YPWNocm9taXVtCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMLCBBUFBfX1BBR0VTX0hPU1QgYW5kIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQgdGhlcmUuCiMgQlJPV1NFUl9fU0VTU0lPTl9BUFBfVVJMPWh0dHA6Ly9hcHA6ODA4MAojIFdyaXRhYmxlIGRlbGVnYXRlZCBjZ3JvdXAgdjIgc3VidHJlZSB3aXRoIGNwdSwgbWVtb3J5IGFuZCBwaWRzIGNvbnRyb2xsZXJzIGVuYWJsZWQuCiMgQlJPV1NFUl9fU0VTU0lPTl9DR1JPVVBfUk9PVD0vc3lzL2ZzL2Nncm91cC9hZmJpbi1zZXNzaW9ucwojIExpdmUgYnJvd3NlciBzZXNzaW9ucyB0aGlzIHNlcnZpY2UgaG9sZHMsIHNoYXJlZCBieSBldmVyeSBvd25lciwgYW5kIGhvdyBtYW55IG9uZQojIGNyZWRlbnRpYWwgbWF5IGhvbGQuIFdob2xlIG51bWJlcnMgb2YgYXQgbGVhc3QgMTsgZWFjaCBzZXNzaW9uIHN0aWxsIGdldHMgMSBHaUIuCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVg9MgojIEJST1dTRVJfX1NFU1NJT05fTUFYX1BFUl9BQ1RPUj0yCiMgQXV0aCBvd25lciBSUEMgb3JpZ2luIGZvciBzcGxpdC1ob3N0IGh1bWFuIHBhZ2VzIHNlc3Npb25zIChwcml2YXRlIHNlcnZpY2UgbmV0d29yaykuCiMgQVVUSF9fU0VSVklDRV9VUkw9aHR0cDovL2F1dGg6MzAwMAojIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVD0KIyBTUUxfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9zcWw6ODA4MAojIEV2ZW50cyB1c2UgdGhlIGxvY2FsIGRhdGFiYXNlIHVubGVzcyBhbiBIVFRQIHNlcnZpY2UgVVJMIGlzIGNvbmZpZ3VyZWQuCiMgRVZFTlRTX19TRVJWSUNFX1VSTD1odHRwOi8vZXZlbnRzOjgwODAKIyBFVkVOVFNfX1NDSEVNQT1ldmVudHMKRVhQT1JUX19JTlRFUk5BTF9PUklHSU49CgojIE9wdGlvbmFsIGRhdGFiYXNlIHNjaGVtYSBuYW1lcy4gQVVUSF9fU0NIRU1BIGFsc28gaG9sZHMgdGhlIGlkZW50aXR5IG1vZHVsZSdzIHRhYmxlcyAodXNlcnMsIHRva2VucywKIyBncm91cHMg4oCmKTsgSURFTlRJVFlfX1NDSEVNQSBpcyB0aGUgaWRlbnRpdHkgcmVhZCB2aWV3cyBldmVyeSByZWFkZXIgKHRoaXMgYXBwLCBvdGhlciBzZXJ2aWNlcykgcmVhZHMgdGhlbSB0aHJvdWdoLgojIEFVVEhfX1NDSEVNQT1hdXRoCiMgQVBQX19TQ0hFTUE9YXBwCiMgSURFTlRJVFlfX1NDSEVNQT1pZGVudGl0eQoKIyBPcHRpb25hbCBHb29nbGUgbG9naW4uCiMgQVVUSF9fR09PR0xFX0NMSUVOVF9JRD0KIyBBVVRIX19HT09HTEVfQ0xJRU5UX1NFQ1JFVD0KCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgoKCiMgQ29tcGFueSBob3N0aW5nIHJlcXVpcmVzIGEgZGVzaWduYXRlZCB2ZXJpZmllZCBib290c3RyYXAgb3duZXIuCkFQUF9fREVQTE9ZTUVOVF9NT0RFPXB1YmxpYwpBUFBfX0RFUExPWU1FTlRfT1dORVJfRU1BSUw9CkFVVEhfX0lOVklURV9PTkxZPXRydWUKQVVUSF9fQUxMT1dFRF9FTUFJTF9QQVRURVJOUz0qCiMgVGVzdC1kb21haW4gYWNjb3VudHMgZm9yIGF1dG9tYXRlZCBydW5zICh0aGUgYWdlbnQgZXZhbHMpOiB3aXRoIGJvdGggc2V0LCBhbnkgYWRkcmVzcyBhdCBleGFjdGx5IFRFU1RfRE9NQUlOCiMgKG5vdCBhIHN1YmRvbWFpbiBvciBhIGxvb2stYWxpa2UpIHNpZ25zIGluIHdpdGggVEVTVF9ET01BSU5fT1RQIHRocm91Z2ggdGhlIG5vcm1hbCBsb2dpbiBhbmQgcmVjZWl2ZXMgbm8gbWFpbDsKIyB0aGUgY29kZSBpcyBzaW5nbGUgdXNlIHdpdGggZml2ZSBhdHRlbXB0cyBhbmQgdGhlIHVzdWFsIHJhdGUgbGltaXRzLiBOZXcgcm93cyBhcmUgbWFya2VkIHVzZXJzLnRlc3RfYWNjb3VudCBhbmQKIyBib3hlZCBpbiAoc2VydmljZXMvYXBwL2xpYi9hY2NvdW50cy90ZXN0LWFjY291bnRzLnRzKS4gRWl0aGVyIHVuc2V0ID0gb2ZmOyBhbiBpbnZhbGlkIHBhaXIgaXMgb2ZmIGFuZCBsb2dnZWQuCiMgVGhlIGlkZW50aXR5IHNlcnZpY2UgYW5kIHRoZSBhcHAgYm90aCByZWFkIHRoZSBwYWlyOiBnaXZlIGEgc3BsaXQgZGVwbG95bWVudCB0aGUgc2FtZSB2YWx1ZXMgaW4gYm90aC4KIyBURVNUX0RPTUFJTl9PVFA6IDMyLTEyOCBjaGFyYWN0ZXJzIG9mIEEtWiBhLXogMC05IC0gXyAoZS5nLiBvcGVuc3NsIHJhbmQgLWhleCAzMikuCiMgVEVTVF9ET01BSU49CiMgVEVTVF9ET01BSU5fT1RQPQoKIyBUcnVzdGVkLWlzc3VlciBzaWduLWluOiBzaXRlcyB0aGUgb3BlcmF0b3IgdHJ1c3RzIHNpZ24gYSBwZXJzb24gaW4gaGVyZSB3aXRoIGEgc2hvcnQtbGl2ZWQgRWQyNTUxOS1zaWduZWQgdG9rZW4KIyAoRWREU0EgSldULCBhdCBtb3N0IDMwMCBzLCBzaW5nbGUtdXNlIGp0aSkgdGhhdCB0aGVpciBwYWdlIHN1Ym1pdHMgYXMgYSBmb3JtIHRvIFBPU1QgL2FwaS9hdXRoL3RydXN0ZWQtc2lnbi1pbgojICh0b2tlbiwgb3B0aW9uYWwgc2FtZS1vcmlnaW4gY2FsbGJhY2tVcmwpLCBmcm9tIG9uZSBvZiB0aGUgaXNzdWVyJ3Mgb3JpZ2lucy4gVGhlIHBlcnNvbiAoaGFuZGxlID0gc3ViKSwgdGhlIGdyb3VwCiMgKGhhbmRsZSA9IGdyb3VwLCB1bmRlciBwYXJlbnRHcm91cCB3aGVuIHNldCwgaXRzIHRlbmFuY3lfaWQgZml4ZWQgYXQgY3JlYXRpb24pIGFuZCB0aGUgbWVtYmVyc2hpcCBhcmUgY3JlYXRlZCBvbgojIGZpcnN0IHNpZ2h0OyBoYW5kbGVzIHRoZSBpc3N1ZXIgZGlkIG5vdCBjcmVhdGUgYXJlIHJlZnVzZWQuIEpTT04gbGlzdDsgZW1wdHkgPSBvZmYuIEV4YW1wbGU6CiMgW3siaXNzdWVyIjoicGFydG5lciIsImF1ZGllbmNlIjoidGhpcy1hcHAiLCJvcmlnaW5zIjpbImh0dHBzOi8vcGFydG5lci5leGFtcGxlIl0sInB1YmxpY0p3ayI6eyJrdHkiOiJPS1AiLCJjcnYiOiJFZDI1NTE5IiwieCI6Ii4uLiJ9LCJwYXJlbnRHcm91cCI6InRlYW0ifV0KIyBUUlVTVEVEX1NJR05JTl9fSVNTVUVSUz0K';
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
