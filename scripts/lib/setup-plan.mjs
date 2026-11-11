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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAod2ViIGluZ2VzdGlvbiwgd2ViaG9va3MpLgojIENvbW1hLXNlcGFyYXRlZCBJUHY0IG9yIElQdjY7IHNlcnZlZCBhdCBHRVQgL2FwaS9vdXRib3VuZC1pcHMgc28gb3duZXJzIGtub3cgd2hhdCB0byBhbGxvdyBpbiBhIGZpcmV3YWxsLiBVbnNldCBzZXJ2ZXMgYW4gZW1wdHkgbGlzdDsgYSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX09VVEJPVU5EX0lQUz0yMDMuMC4xMTMuMTAKIyBSRVFVSVJFRC4gRXZlcnkgZG9jdW1lbnQgaXMgc2VydmVkIG9uIGl0cyBvd24gb3JpZ2luLCA8aGV4IGlkPi48dGhpcyBob3N0PiwgZnJhbWVkIGJ5IHRoZSBhcHAgcGFnZS4KIyBBIGJhcmUgaG9zdG5hbWU7IHNjaGVtZSBhbmQgcG9ydCBmb2xsb3cgQVBQX19QVUJMSUNfQkFTRV9VUkwuIFVuc2V0IHJlZnVzZXMgdGhlIGJvb3QuIE92ZXIgaHR0cHMgaXQgbWF5IGJlCiMgYSByZWdpc3RyYWJsZSBkb21haW4gb2YgaXRzIG93biAocmVjb21tZW5kZWQgaW4gcHJvZHVjdGlvbjsgdGhlIGZyYW1lJ3MgY29va2llIGlzIFNhbWVTaXRlPU5vbmU7IFBhcnRpdGlvbmVkKSwKIyB3aXRoIHdpbGRjYXJkIEROUyBhbmQgVExTIGZvciAqLjxob3N0Pi4gT3ZlciBwbGFpbiBodHRwIHRoZSBhcHAgbXVzdCBiZSBvbiB0aGUgc2FtZSBzaXRlIChTYW1lU2l0ZT1MYXgpLgojIERldmVsb3BtZW50OiBsdmgubWUsIGJyb3dzaW5nIHRoZSBhcHAgYXQgaHR0cDovL2FwcC5sdmgubWU6PHBvcnQ+IChucG0gcnVuIHNldHVwIHdyaXRlcyBib3RoKS4KQVBQX19QQUdFU19IT1NUPWx2aC5tZQpBUFBfX1BPUlQ9MzAzMAojIEFQUF9fSE9TVD0KQVBQX19ITVJfUE9SVD0KCiMgUGVyLXRva2VuIGFydGlmYWN0IGNhcDsgMCBkaXNhYmxlcyB0aGUgY2FwLgpRVU9UQV9fQVJUSUZBQ1RTX1BFUl9UT0tFTj0xMDAwCgojIFN0b3JlZCBhc3NldHMgcGVyIGFjY291bnQgKHVwbG9hZHMgKyBVUkxzIGltcG9ydGVkIGZpcnN0KSwgMTAgR0I7IGFub255bW91cyB0b2tlbnMgaGF2ZSB0aGVpciBvd24gY2FwLiAwIGRpc2FibGVzLgojIEFTU0VUU19fTUFYX0JZVEVTX1BFUl9UT0tFTj0xMDAwMDAwMDAwMAoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZW1haWwtY29kZSBsb2dpbiB1c2VzIGVpdGhlciBTTVRQIG9yIFJlc2VuZCB3aXRoIGFuIGF1dGhvcml6ZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CiMgU01UUCBhbHRlcm5hdGl2ZTogZGVmYXVsdCBwb3J0IDU4NyByZXF1aXJlcyBTVEFSVFRMUzsgc2VjdXJlPXRydWUgdXNlcyBpbXBsaWNpdCBUTFMgKGRlZmF1bHQgNDY1KS4KRU1BSUxfX1NNVFBfSE9TVD0KRU1BSUxfX1NNVFBfUE9SVD0KRU1BSUxfX1NNVFBfU0VDVVJFPQpFTUFJTF9fU01UUF9VU0VSPQpFTUFJTF9fU01UUF9QQVNTV09SRD0KRU1BSUxfX0ZST009YXJ0aWZhY3RiaW4gPGxvZ2luQGV4YW1wbGUuY29tPgoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMDAKUERGX19NQVhfQllURVM9NTAwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKClNRTF9fTUFYX1JPV1M9MTAwMDAKU1FMX19NQVhfUVVFUllfUk9XUz0xMDAwMApTUUxfX1FVRVJZX1RJTUVPVVRfTVM9NTAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgaW4gZnJvbnQgb2YgdGhpcyBhcHA6IHRoZXkgc2V0IFgtRm9yd2FyZGVkLUZvci8tSG9zdC8tUHJvdG8sIHJlYWQgdGhhdCBtYW55CiMgZW50cmllcyBmcm9tIHRoZSBlbmQuIDA6IG5vIHByb3h5LCBzbyB0aG9zZSBoZWFkZXJzIGFyZSBpZ25vcmVkIGFuZCBIb3N0IGlzIHRoZSBhZGRyZXNzZWQgaG9zdCAoYW5vbnltb3VzCiMgcmVhZGVycyB0aGVuIHNoYXJlIG9uZSByYXRlLWxpbWl0IGJ1Y2tldDogbm8gYWRkcmVzcyBpZGVudGlmaWVzIHRoZW0pLgpIVFRQX19UUlVTVEVEX1BST1hZX0hPUFM9MQoKIyBPcHRpb25hbCBkZXBsb3ltZW50IGNvbnRyb2xzLgojIEFSVElGQUNUU19fQUxMT1dfUFVCTElDPTEKIyBBbm9ueW1vdXMgdXNlci9ncm91cCBwdWJsaXNoaW5nIGhvc3RzLiBPZmYgYnkgZGVmYXVsdDsgYSBiYXJlIGhvc3RuYW1lLiBFYWNoIGxpdmUgdXNlciBvciBncm91cCBoYW5kbGUKIyAodW5kZXJzY29yZXMgYmVjb21lIGh5cGhlbnMpIGdldHMgPGhhbmRsZT4uPHRoaXMgaG9zdD46IHB1YmxpYyBIVE1MIG9uIGl0cyBob21lLCB1bmxpc3RlZCBieSBJRCBvbmx5IChub2luZGV4LAojIG5vLXJlZmVycmVyKS4gRXZlcnkgcmVxdWVzdCB0aGVyZSBpcyBhIGd1ZXN0J3MsIGNvb2tpZXMgb3Igbm90OiBzcWwgcmVhZHMgb25seS4KIyBXaWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgaXQgYXJlIHRoZSBvcGVyYXRvcidzOyB0aGUgcHJvZHVjdCBuZXZlciBwcm92aXNpb25zIGEgaG9zdG5hbWUuCiMgQVBQX19VU0VSX1BBR0VTX0hPU1Q9dS5leGFtcGxlLmNvbQojIEEgY3VzdG9tIHNoZWxsOiBvbmUgSFRNTCBmaWxlIHRoaXMgcHJvY2VzcyBjYW4gcmVhZCwgc2VydmVkICgyMDAsIG5vLXN0b3JlLCB0aGUgYXBwJ3MgQ1NQLCBhIExpbmsgcmVsPSJoZWxwIiB0bwojIC9sbG1zLnR4dCkgaW4gcGxhY2Ugb2YgdGhlIGFwcCdzIG93biBzY3JlZW5zOiBleGFjdGx5IHRoZSBhZGRyZXNzZXMgdGhlIFVSTCBtYXAgY2FsbHMgc2NyZWVucyAoL2FmL3VybC1zcGFjZS5qc29uLAojIGNvbnRyYWN0cyBpc1NjcmVlblBhdGgpOiAvLCBldmVyeSBhcHAgc2NyZWVuLCB0aGUgcGFnZSBhbmQgaGFuZGxlIHNjcmVlbnMgL2EvPGlkPiwgL2EvPGlkPi9lZGl0LCAvQDxoYW5kbGU+IGFuZAojIC9APGhhbmRsZT4vPHNsdWc+LCAvbG9naW4gZm9yIGEgYnJvd3NlciB3aXRob3V0IGEgc2Vzc2lvbiAod2l0aCBvbmUsIC9sb2dpbiBzZW5kcyBpdCB0byBpdHMgc2FtZS1vcmlnaW4gY2FsbGJhY2tVcmwpLAojIGFuZCBldmVyeSBhZGRyZXNzIHRoZSBhcHAgZG9lcyBub3Qgb3RoZXJ3aXNlIHNlcnZlLCBzbyBpdCBjYW4gcm91dGUgY2xpZW50LXNpZGUuIFRoZSBhcHAga2VlcHMgdGhlIHJlc3Q6IHRoZSBBUEksCiMgL2FmLywgb2xkIGFkZHJlc3NlcywgZXZlcnkgb3RoZXIgZml4ZWQgcGF0aCAoT0F1dGggYW5kIGl0cyBjb25zZW50IHBhZ2UsIC9sbG1zLCAvd2VsY29tZSwgL3N0YXJ0LCAvbG9jYWwvY29ubmVjdCwKIyAuLi4pLCBldmVyeSBkb29yIHVuZGVyIC9hLzxpZD4vLCB0aGUgaW5zdGFsbGVkIGFwcCAvYS88aWQ+L2FwcC8gYW5kIGV4cG9ydCBjYXB0dXJlcyAoP2tleT0pOyBpdHMgb3RoZXIgc2NyZWVucyBhcmUKIyBub3QgcmVhY2hhYmxlLiBfX0NTUF9OT05DRV9fIGluc2lkZSBhbiBhdHRyaWJ1dGUgdmFsdWUgKG5vbmNlPSIuLi4iLCBhIG1ldGEgY29udGVudCkgYmVjb21lcyB0aGUgcmVzcG9uc2UncyBzY3JpcHQKIyBub25jZTsgdGhlIGZpcnN0IF9fSEVBRF9UQUdTX18gd3JpdHRlbiBhcyBtYXJrdXAgaW5zaWRlIDxoZWFkPiBiZWNvbWVzIGEgZG9jdW1lbnQncyBvd24gdGl0bGUsIGRlc2NyaXB0aW9uIGFuZAojIHNvY2lhbCBjYXJkIHdoZXJlIGFuIGFub255bW91cyByZWFkZXIgbWF5IHJlYWQgaXQgKGVsc2Ugbm90aGluZyk7IGFueSBvdGhlciBvY2N1cnJlbmNlIChpbiBhIHNjcmlwdCwgc3R5bGUsCiMgY29tbWVudCwgdGV4dCBvciB0aGUgYm9keSkgc3RheXMgbGl0ZXJhbC4gVW5yZWFkYWJsZTogbm8gYm9vdC4KIyBBUFBfX1NIRUxMX0ZJTEU9L2V0Yy9hcnRpZmFjdGJpbi9zaGVsbC5odG1sCiMgU2tpbGwgZXh0cmFzOiBhIGZsYXQgZGlyZWN0b3J5IHRoaXMgcHJvY2VzcyBjYW4gcmVhZCB3aG9zZSAubWQgZ3VpZGVzLCAubWpzIHNjcmlwdHMgYW5kIC5qc29uIGZpbGVzIHRoZSBhdXRob3IKIyBza2lsbCB0aGlzIG9yaWdpbiBzZXJ2ZXMgKC9za2lsbHMvYXJ0aWZhY3RiaW4uemlwKSBjYXJyaWVzIHVuZGVyIGV4dHJhcy8sIHdpdGggYSBnZW5lcmF0ZWQgZXh0cmFzL1JFQURNRS5tZCBpbmRleAojIChlYWNoIGd1aWRlIG5lZWRzIGEgIiMgIiBoZWFkaW5nOyBhICJSZWFkIHdoZW4gLi4uIiBsaW5lIGlzIGxpc3RlZCB0b28pLiBUaGV5IGFyZSBvcGVyYXRvciBpbnN0cnVjdGlvbnMgYW5kIGNvZGUKIyBzaGlwcGVkIHRvIGFnZW50cywgYW5kIHB1YmxpYzogbm8gc2VjcmV0cy4gTm8gaGlkZGVuIGZpbGVzLCBzdWJkaXJlY3RvcmllcyBvciBzeW1saW5rczsgMzIgZmlsZXMsIDY0IEtpQiBlYWNoLAojIDI1NiBLaUIgaW4gYWxsLiBSZWFkIGF0IGJvb3Q7IGludmFsaWQ6IG5vIGJvb3QuIEVuYWJsZSBvbmx5IG9uY2UgaW5zdGFsbHMgcnVuIGFuIHVwZGF0ZXIgdGhhdCBhY2NlcHRzIGV4dHJhcy8uCiMgU0tJTExTX19FWFRSQV9ESVI9L2V0Yy9hcnRpZmFjdGJpbi9za2lsbC1leHRyYXMKIyBBTkFMWVRJQ1NfX1NFQ1JFVD0KCiMgU2VydmljZXMgdGhhdCBhY2NlcHQgdGhpcyBpbnN0YWxsYXRpb24ncyBpZGVudGl0eSB0b2tlbnMgKGFuIGlkZW50aXR5LXNpZGUgc2V0dGluZzsgZW1wdHkgYnkgZGVmYXVsdCk6IGVhY2gKIyBhbiBpZCwgdGhlIG9yaWdpbiBpdHMgdG9rZW5zIGFyZSBib3VuZCB0bywgYW5kIG9wdGlvbmFsbHkgdGhlIFNIQS0yNTYgKGhleCkgb2YgdGhlIHNlY3JldCBpdCBpbnRyb3NwZWN0cyB3aXRoCiMgKFBPU1QgL2FwaS9pbnRlcm5hbC9pZGVudGl0eS9pbnRyb3NwZWN0LCBhbnN3ZXJpbmcgaXQgb25seSBmb3IgdG9rZW5zIG9mIGl0cyBvd24gYXVkaWVuY2UpLiBBIHBlcnNvbiBzaWducyBpbgojIGZvciBvbmUgd2l0aCBgYXV0aC5tanMgbG9naW4gLi4uIC0tYXVkaWVuY2UgSURgIChvciBPQXV0aCB3aXRoIHJlc291cmNlPTxvcmlnaW4+KTsgYSB0b2tlbiBmb3IgaXQgaXMgbmV2ZXIKIyBhY2NlcHRlZCBieSB0aGlzIHNlcnZlcidzIEFQSS4gQSBjYWxsZXIgYWxyZWFkeSBob2xkaW5nIGEgY3JlZGVudGlhbCBoZXJlLCBhIHNpZ25lZC1pbiBwYWdlIChzYW1lIE9yaWdpbikgb3IgYW4KIyBvcmRpbmFyeSBBUEkgYmVhcmVyLCBleGNoYW5nZXMgaXQgZm9yIGEgNS1taW51dGUgdG9rZW4gZm9yIHRoYXQgc2VydmljZSwgbm8gcmVmcmVzaCB0b2tlbiwgZW5kaW5nIHdpdGggdGhhdAojIGNyZWRlbnRpYWw6IFBPU1QgL2FwaS9hdXRoZW50aWNhdGlvbi9zZXJ2aWNlLXRva2VuIHsiYXVkaWVuY2UiOiI8aWQ+In0uICgvYXBpL2F1dGhlbnRpY2F0aW9uL3Rva2VuLCB0aGUgbG9uZwojIGdyYW50LCByZWZ1c2VzIGFueSByZXF1ZXN0IGEgcGFnZSBtYWtlcy4pIFNldCBpdCBvbiB0aGUgYXBwIGFuZCBvbiBhIHNlcGFyYXRlIGF1dGggaG9zdCBhbGlrZS4KIyBJREVOVElUWV9fU0VSVklDRV9BVURJRU5DRVM9W3siaWQiOiJ3YXJlaG91c2UiLCJvcmlnaW4iOiJodHRwczovL2RhdGEuZXhhbXBsZS5jb20iLCJpbnRyb3NwZWN0aW9uX3NlY3JldF9zaGEyNTYiOiI8NjQgaGV4PiJ9XQojIE9BdXRoIGNsaWVudHMgdGhlIG9wZXJhdG9yIHJlZ2lzdGVycyAocHVibGljLCBQS0NFLCBubyBzZWNyZXQpOiBhIGZpeGVkIGlkIGFuZCByZWRpcmVjdHMgKGh0dHBzLCBvciBodHRwIG9uIGEKIyBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSwgYW5kIGEgbmFtZSBwZW9wbGUgc2VlIGF0IGNvbnNlbnQsIGUuZy4gYSBzZXJ2aWNlJ3Mgd2ViIGFwcGxpY2F0aW9uIHNpZ25pbmcgYnJvd3NlcnMgaW4KIyAocmVzb3VyY2U9PGl0cyBvcmlnaW4+LCBvciB0aGlzIEFQSSkuICJmaXJzdF9wYXJ0eSI6IHRydWUgbWFrZXMgaXQgcGFydCBvZiB0aGlzIGRlcGxveW1lbnQncyBzaWduLWluOiBubyBjb25zZW50CiMgcGFnZSwgYW5kIGl0cyBncmFudHMgZW5kIHdoZW4gdGhlIGJyb3dzZXIgc2Vzc2lvbiB0aGF0IGFwcHJvdmVkIHRoZW0gZW5kcyAoc2lnbi1vdXQpLgojIElERU5USVRZX19PQVVUSF9DTElFTlRTPVt7ImNsaWVudF9pZCI6IndhcmVob3VzZS13ZWIiLCJuYW1lIjoiV2FyZWhvdXNlIiwicmVkaXJlY3RfdXJpcyI6WyJodHRwczovL2RhdGEuZXhhbXBsZS5jb20vYXV0aC9jYWxsYmFjayJdLCJmaXJzdF9wYXJ0eSI6dHJ1ZX1dCiMgVGhlIGluc3RhbGwncyBkZWZhdWx0IGNvbm5lY3Rpb246IG9uZSBjb25uZWN0b3IgY29uZmlndXJhdGlvbiAocG9zdGdyZXMsIG15c3FsOyBzZWNyZXRzIGluY2x1ZGVkKSwgd2hpY2ggZXZlcnkKIyBzaWduZWQtaW4gcGVyc29uIG1heSBxdWVyeSByZWFkLW9ubHksIGZyb20gYSBwYWdlICg8bGluayByZWw9ImFmLWRhdGFzZXQiIGRhdGEtYWYtbmFtZT0iTkFNRSIgaHJlZj0iZGVmYXVsdDpEQiI+LAojIERCIHRoZSBkYXRhYmFzZSB0aGUgc2Vzc2lvbiBvcGVucywgYXMgd3JpdHRlbjsgU1FMIG5hbWluZyBOQU1FLnRhYmxlKSBvciBhbiBhZ2VudCAoc3FsLm1qcyBxdWVyeSBkZWZhdWx0OkRCKS4KIyBHaXZlIHRoZSBhY2NvdW50IHJlYWQtb25seSBncmFudHMuICJ0bHMiOiAidmVyaWZ5LWZ1bGwiICh0aGUgZGVmYXVsdDsgImNhIjogYSBQRU0gYnVuZGxlIGZvciBhIHByaXZhdGUgcm9vdCkgb3IKIyAiZGlzYWJsZSIuIEVhY2ggc3RhdGVtZW50IG5hbWVzIGl0cyByZWFkZXIgaW5zaWRlIGl0cyBvd24gcmVhZC1vbmx5IHRyYW5zYWN0aW9uIChhcHAudmlld2VyX2lkLCBhcHAudmlld2VyX2VtYWlsLAojIGFwcC52aWV3ZXJfZ3JvdXBzOyBNeVNRTCBAYXBwLnZpZXdlcl8qKTogYWR2aXNvcnkgb24gYSBwbGFpbiBkYXRhYmFzZSwgc2luY2UgYSByZWFkZXIncyBTUUwgY291bGQgY2hhbmdlIHRoZW0uCiMgU2hvd24gb24gdGhlIHNldHRpbmdzIHBhZ2Ugd2l0aG91dCB0aGUgdXNlciBvciBwYXNzd29yZC4gSW52YWxpZDogbm8gYm9vdCAodGhlIGVycm9yIG5hbWVzIHRoaXMgc2V0dGluZywgbmV2ZXIKIyB0aGUgdmFsdWUpLgojIERBVEFTRVRTX19ERUZBVUxUX0NPTk5FQ1RJT049eyJjb25uZWN0b3IiOiJwb3N0Z3JlcyIsImhvc3QiOiJkYi5leGFtcGxlLmNvbSIsImRhdGFiYXNlIjoic2hvcCIsInVzZXIiOiJyZWFkZXIiLCJwYXNzd29yZCI6Ii4uLiJ9CiMgMSBsZXRzIGNvbm5lY3Rpb25zIHJlYWNoIGxvb3BiYWNrIGFuZCBwcml2YXRlIGFkZHJlc3NlcyBhbmQgdHVybiBUTFMgb2ZmICgidGxzIjoiZGlzYWJsZSIpLCBmb3IgZGV2ZWxvcG1lbnQgb3IgYQojIGRhdGFiYXNlIG9uIHRoaXMgaW5zdGFsbCdzIG93biBuZXR3b3JrOyAwICh0aGUgZGVmYXVsdCk6IHB1YmxpYyBhZGRyZXNzZXMgb3ZlciB2ZXJpZmllZCBUTFMgb25seS4gTGluay1sb2NhbCBhbmQKIyBjbG91ZCBtZXRhZGF0YSBhZGRyZXNzZXMgYXJlIHJlZnVzZWQgZWl0aGVyIHdheS4KIyBEQVRBU0VUU19fQUxMT1dfUFJJVkFURV9ORVRXT1JLPTAKIyBPcmlnaW5zIChodHRwcywgb3IgaHR0cCBvbiBhIGxvY2FsIGRldmVsb3BtZW50IGhvc3QpIGFsbG93ZWQgdG8gZnJhbWUgYSBkb2N1bWVudCdzIGFkZHJlc3M6IHRoZSAvYS88aWQ+IGFwcAojIHBhZ2UgYW5kIHRoZSBkb2N1bWVudCBpdCBmcmFtZXMuIE9ubHkgdGhleSBtYXkgZnJhbWUgaXRzIGVtYmVkZGVkIHZpZXcgKC9hLzxpZD4/ZW1iZWQ9MSwgbm8gYXBwIGJhcikuIEVtcHR5OgojIGZyYW1lZCBieSB0aGUgYXBwIGFsb25lLgojIEVNQkVEX19UUlVTVEVEX09SSUdJTlM9CiMgR3JvdXAgYXBwcm92YWwgb2YgdGhlIGFkZHJlc3NlcyBhIHBhZ2UgbWF5IGNhbGw6IG9uICh0aGUgZGVmYXVsdCkgb3Igb2ZmLiBPbiwgYSBncm91cCdzIGVkaXRvcnMgbWF5IGFwcHJvdmUgYW4KIyBleGFjdCBodHRwcyBvcmlnaW4gYSBwYWdlIGRlY2xhcmVzIGZvciBjb25uZWN0LCBpbWcgb3IgbWVkaWEgKG5ldmVyIHNjcmlwdCwgc3R5bGUgb3IgZnJhbWUsIG5ldmVyIGEgd2lsZGNhcmQpLCBhbmQKIyBldmVyeSBtZW1iZXIgb2YgdGhlIGdyb3VwIGFuZCBpdHMgc3ViZ3JvdXBzIGlzIHRoZW4gbm90IGFza2VkIGFib3V0IGl0IG9uIGFueSBwYWdlLiBPZmY6IG5vdCBvZmZlcmVkLCB0aGUgZ3JvdXAKIyBhZGRyZXNzZXMgQVBJIGFuc3dlcnMgZ3JvdXBfYXBwcm92YWxzX2Rpc2FibGVkLCBhbmQgc3RvcmVkIGFwcHJvdmFscyBhcmUgaWdub3JlZCAoa2VwdCwgbm90IGRlbGV0ZWQpLgojIFRSVVNUX19HUk9VUF9BUFBST1ZBTFM9b24KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBPcHRpb25hbCBkaXJlY3QgZXhwb3J0IHVwbG9hZDogdGhlIGJyb3dzZXIgc2VydmljZSBQVVRzIGVhY2ggcmVuZGVyZWQgaW1hZ2UgdG8gdGhlIGFwcCdzIHNpZ25lZCBVUkwgaXRzZWxmLgojIFRoZSBleGFjdCBIVFRQUyBvcmlnaW4gdGhlIGFwcCdzIHNpZ25lciBlbWl0cywgYW5kIHRoZSBhYnNvbHV0ZSBwYXRoIGVuZGluZyBpbiAvZXhwb3J0cy9vYmplY3RzLyAocGF0aC1zdHlsZQojIHN0b3JhZ2UgcHV0cyB0aGUgYnVja2V0IGluIHRoZSBwYXRoIHRvbykuIFRoZSB1cGxvYWQgZ2F0ZXdheSBnZXRzIHRoZSBzYW1lIHR3byB2YWx1ZXMgYW5kIG5vIFMzIGNyZWRlbnRpYWxzLgojIEJST1dTRVJfX1VQTE9BRF9PUklHSU49aHR0cHM6Ly9idWNrZXQuczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20KIyBCUk9XU0VSX19VUExPQURfUFJFRklYPS9hcnRpZmFjdHMvZXhwb3J0cy9vYmplY3RzLwojIEludGVybmFsLW9ubHkgYnJvd3NlcnMgcmVhY2ggUzMgdGhyb3VnaCB0aGUgc2NvcGVkIHVwbG9hZCBnYXRld2F5IChzZXJ2aWNlcy9icm93c2VyL3NyYy91cGxvYWQtZ2F0ZXdheS1zZXJ2ZXIudHMpLAojIHdoaWNoIGpvaW5zIHRoZSBjb21wdXRlIGFuZCBlZ3Jlc3MgbmV0d29ya3MsIHB1Ymxpc2hlcyBubyBwb3J0LCBhZG1pdHMgb25seSBib3VuZGVkIFBORyBhbmQgSlBFRyBQVVRzIHRvIHRoYXQKIyBvcmlnaW4gYW5kIHByZWZpeCwgYW5kIGZvbGxvd3Mgbm8gcmVkaXJlY3QuCiMgQlJPV1NFUl9fVVBMT0FEX1BST1hZX1VSTD1odHRwOi8vdXBsb2FkLWdhdGV3YXk6ODA4MAojIEJyb3dzZXIgc2Vzc2lvbnMgcmVxdWlyZSBMaW51eCBidWJibGV3cmFwIHdpdGggdW5wcml2aWxlZ2VkIHVzZXIgbmFtZXNwYWNlcy4KIyBERVZFTE9QTUVOVCBPTkxZLiBCUk9XU0VSX19TQU5EQk9YPW5vbmUgcnVucyB0aGUgc2Vzc2lvbiB3b3JrZXIgYXMgYSBwbGFpbiBjaGlsZAojIHByb2Nlc3M6IG5vIGJ1YmJsZXdyYXAsIG5vIGNncm91cCwgTk8gT1MgY29udGFpbm1lbnQg4oCUIGEgc2Vzc2lvbiBzY3JpcHQgdGhlbiBoYXMgdGhlCiMgd2hvbGUgbWFjaGluZSwgdGhpcyBjaGVja291dCBhbmQgdGhlIG5ldHdvcmsuIEl0IGV4aXN0cyBzbyBsaXZlIHNlc3Npb25zIHJ1biBvbiBhCiMgbWFjT1MgZGV2IGhvc3QgYXQgYWxsOyBgbnBtIHJ1biBkZXZgIGFscmVhZHkgZGVmYXVsdHMgaXQgdGhlcmUuIEl0IGlzIHJlZnVzZWQgd2hlbgojIE5PREVfRU5WPXByb2R1Y3Rpb24sIGFuZCBhbnkgb3RoZXIgdmFsdWUgaXMgcmVmdXNlZCBvdXRyaWdodC4gTmV2ZXIgc2V0IGl0IG9uIGEgc2VydmVyLgojIEJST1dTRVJfX1NBTkRCT1g9bm9uZQojIFNwbGl0IGJyb3dzZXIgc2VydmljZTogdHJ1c3RlZCBhcHAgVVJMOyBhbHNvIHNldCBBUFBfX1BVQkxJQ19CQVNFX1VSTCwgQVBQX19QQUdFU19IT1NUIGFuZCBDT05UUkFDVF9fQUNUT1JfU0VDUkVUIHRoZXJlLgojIEJST1dTRVJfX1NFU1NJT05fQVBQX1VSTD1odHRwOi8vYXBwOjgwODAKIyBXcml0YWJsZSBkZWxlZ2F0ZWQgY2dyb3VwIHYyIHN1YnRyZWUgd2l0aCBjcHUsIG1lbW9yeSBhbmQgcGlkcyBjb250cm9sbGVycyBlbmFibGVkLgojIEJST1dTRVJfX1NFU1NJT05fQ0dST1VQX1JPT1Q9L3N5cy9mcy9jZ3JvdXAvYWZiaW4tc2Vzc2lvbnMKIyBMaXZlIGJyb3dzZXIgc2Vzc2lvbnMgdGhpcyBzZXJ2aWNlIGhvbGRzLCBzaGFyZWQgYnkgZXZlcnkgb3duZXIsIGFuZCBob3cgbWFueSBvbmUKIyBjcmVkZW50aWFsIG1heSBob2xkLiBXaG9sZSBudW1iZXJzIG9mIGF0IGxlYXN0IDE7IGVhY2ggc2Vzc2lvbiBzdGlsbCBnZXRzIDEgR2lCLgojIEJST1dTRVJfX1NFU1NJT05fTUFYPTIKIyBCUk9XU0VSX19TRVNTSU9OX01BWF9QRVJfQUNUT1I9MgojIEF1dGggb3duZXIgUlBDIG9yaWdpbiBmb3Igc3BsaXQtaG9zdCBodW1hbiBwYWdlcyBzZXNzaW9ucyAocHJpdmF0ZSBzZXJ2aWNlIG5ldHdvcmspLgojIEFVVEhfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9hdXRoOjMwMDAKIyBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQ9CiMgU1FMX19TRVJWSUNFX1VSTD1odHRwOi8vc3FsOjgwODAKIyBFdmVudHMgdXNlIHRoZSBsb2NhbCBkYXRhYmFzZSB1bmxlc3MgYW4gSFRUUCBzZXJ2aWNlIFVSTCBpcyBjb25maWd1cmVkLgojIEVWRU5UU19fU0VSVklDRV9VUkw9aHR0cDovL2V2ZW50czo4MDgwCiMgRVZFTlRTX19TQ0hFTUE9ZXZlbnRzCkVYUE9SVF9fSU5URVJOQUxfT1JJR0lOPQoKIyBPcHRpb25hbCBkYXRhYmFzZSBzY2hlbWEgbmFtZXMuIEFVVEhfX1NDSEVNQSBhbHNvIGhvbGRzIHRoZSBpZGVudGl0eSBtb2R1bGUncyB0YWJsZXMgKHVzZXJzLCB0b2tlbnMsCiMgZ3JvdXBzIOKApik7IElERU5USVRZX19TQ0hFTUEgaXMgdGhlIGlkZW50aXR5IHJlYWQgdmlld3MgZXZlcnkgcmVhZGVyICh0aGlzIGFwcCwgb3RoZXIgc2VydmljZXMpIHJlYWRzIHRoZW0gdGhyb3VnaC4KIyBBVVRIX19TQ0hFTUE9YXV0aAojIEFQUF9fU0NIRU1BPWFwcAojIElERU5USVRZX19TQ0hFTUE9aWRlbnRpdHkKCiMgT3B0aW9uYWwgR29vZ2xlIGxvZ2luLgojIEFVVEhfX0dPT0dMRV9DTElFTlRfSUQ9CiMgQVVUSF9fR09PR0xFX0NMSUVOVF9TRUNSRVQ9CgojIE9wdGlvbmFsIE9JREMgbG9naW4uIFVzZSBleHBsaWNpdCBlbmRwb2ludHMgb3IgZGlzY292ZXJ5LCBub3QgYm90aC4KIyBBVVRIX19PSURDX1BST1ZJREVSX0lEPW9pZGMKIyBBVVRIX19PSURDX0NMSUVOVF9JRD0KIyBBVVRIX19PSURDX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19BVVRIT1JJWkFUSU9OX1VSTD0KIyBBVVRIX19PSURDX1RPS0VOX1VSTD0KIyBBVVRIX19PSURDX1VTRVJJTkZPX1VSTD0KIyBBVVRIX19PSURDX0RJU0NPVkVSWV9VUkw9CgoKCgojIENvbXBhbnkgaG9zdGluZyByZXF1aXJlcyBhIGRlc2lnbmF0ZWQgdmVyaWZpZWQgYm9vdHN0cmFwIG93bmVyLgpBUFBfX0RFUExPWU1FTlRfTU9ERT1wdWJsaWMKQVBQX19ERVBMT1lNRU5UX09XTkVSX0VNQUlMPQpBVVRIX19JTlZJVEVfT05MWT10cnVlCkFVVEhfX0FMTE9XRURfRU1BSUxfUEFUVEVSTlM9KgojIFRlc3QtZG9tYWluIGFjY291bnRzIGZvciBhdXRvbWF0ZWQgcnVucyAodGhlIGFnZW50IGV2YWxzKTogd2l0aCBib3RoIHNldCwgYW55IGFkZHJlc3MgYXQgZXhhY3RseSBURVNUX0RPTUFJTgojIChub3QgYSBzdWJkb21haW4gb3IgYSBsb29rLWFsaWtlKSBzaWducyBpbiB3aXRoIFRFU1RfRE9NQUlOX09UUCB0aHJvdWdoIHRoZSBub3JtYWwgbG9naW4gYW5kIHJlY2VpdmVzIG5vIG1haWw7CiMgdGhlIGNvZGUgaXMgc2luZ2xlIHVzZSB3aXRoIGZpdmUgYXR0ZW1wdHMgYW5kIHRoZSB1c3VhbCByYXRlIGxpbWl0cy4gTmV3IHJvd3MgYXJlIG1hcmtlZCB1c2Vycy50ZXN0X2FjY291bnQgYW5kCiMgYm94ZWQgaW4gKHNlcnZpY2VzL2FwcC9saWIvYWNjb3VudHMvdGVzdC1hY2NvdW50cy50cykuIEVpdGhlciB1bnNldCA9IG9mZjsgYW4gaW52YWxpZCBwYWlyIGlzIG9mZiBhbmQgbG9nZ2VkLgojIFRoZSBpZGVudGl0eSBzZXJ2aWNlIGFuZCB0aGUgYXBwIGJvdGggcmVhZCB0aGUgcGFpcjogZ2l2ZSBhIHNwbGl0IGRlcGxveW1lbnQgdGhlIHNhbWUgdmFsdWVzIGluIGJvdGguCiMgVEVTVF9ET01BSU5fT1RQOiAzMi0xMjggY2hhcmFjdGVycyBvZiBBLVogYS16IDAtOSAtIF8gKGUuZy4gb3BlbnNzbCByYW5kIC1oZXggMzIpLgojIFRFU1RfRE9NQUlOPQojIFRFU1RfRE9NQUlOX09UUD0K';
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
