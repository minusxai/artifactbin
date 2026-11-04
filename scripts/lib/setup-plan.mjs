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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2FwcC5sdmgubWU6MzAzMAojIE9wdGlvbmFsIGRlZGljYXRlZCBvcmlnaW4gdGhhdCBzZXJ2ZXMgb25seSBhbm9ueW1vdXMgY2FjaGVkIGJ5dGVzIGF0IC9hc3NldHMvKi4KIyBQcm9kdWN0aW9uIHJlcXVpcmVzIGEgZGlzdGluY3QgSFRUUFMgaG9zdG5hbWU7IEhUVFAgaXMgYWNjZXB0ZWQgb25seSBvbiBsb29wYmFjay4KIyBBUFBfX0FTU0VUU19PUklHSU49aHR0cHM6Ly9hc3NldHMuZXhhbXBsZS5jb20KIyBPdGhlciBvcmlnaW5zIHRoaXMgc2FtZSBkZXBsb3ltZW50IGFuc3dlcnMgYXQgKGEgbWFya2V0aW5nIGhvc3RuYW1lIHRoYXQgcHJveGllcwojIGhlcmUsIGEgcHJldmlvdXMgbmFtZSkuIENvbW1hLXNlcGFyYXRlZDsgSFRUUFMsIG9yIEhUVFAgb24gbG9vcGJhY2s7IG5vIHBhdGggb3IKIyBjcmVkZW50aWFscy4gU2VydmVkIGF0IEdFVCAvYXBpL3NlcnZlciwgc28gYWZiaW4gdHJlYXRzIGEgbGluayBvciBhIGZvbGRlciBmcm9tCiMgZWl0aGVyIG5hbWUgYXMgdGhpcyBzZXJ2ZXI7IHJlcXVlc3RzIGFuZCBjcmVkZW50aWFscyBzdGlsbCBnbyB0bwojIEFQUF9fUFVCTElDX0JBU0VfVVJMIGFsb25lLiBBIG1hbGZvcm1lZCBlbnRyeSByZWZ1c2VzIHRoZSBib290LgojIEFQUF9fQUxJQVNfT1JJR0lOUz1odHRwczovL2V4YW1wbGUuY29tCiMgVGhlIElQIGFkZHJlc3NlcyB0aGlzIGRlcGxveW1lbnQncyBvdXRib3VuZCB0cmFmZmljIGxlYXZlcyBmcm9tIChyZXNvbHZlciBkYXRhYmFzZXMsIGNhcHMuZmV0Y2gsIHdlYmhvb2tzKS4KIyBDb21tYS1zZXBhcmF0ZWQgSVB2NCBvciBJUHY2OyBzZXJ2ZWQgYXQgR0VUIC9hcGkvb3V0Ym91bmQtaXBzIGFuZCBzaG93biBpbiB0aGUgUmVzb2x2ZXJzIHBhbmVsIHNvIG93bmVycwojIGtub3cgd2hhdCB0byBhbGxvdyBpbiBhIGRhdGFiYXNlIGZpcmV3YWxsLiBVbnNldCBzZXJ2ZXMgYW4gZW1wdHkgbGlzdDsgYSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX09VVEJPVU5EX0lQUz0yMDMuMC4xMTMuMTAKIyBSRVFVSVJFRC4gRXZlcnkgZG9jdW1lbnQgaXMgc2VydmVkIG9uIGl0cyBvd24gb3JpZ2luLCA8aGV4IGlkPi48dGhpcyBob3N0PiwgZnJhbWVkIGJ5IHRoZSBhcHAgcGFnZS4KIyBBIGJhcmUgaG9zdG5hbWUgdW5kZXIgdGhlIGFwcCdzIHJlZ2lzdHJhYmxlIGRvbWFpbiAoc2FtZSBzaXRlKSwgZS5nLiBwYWdlcy5leGFtcGxlLmNvbTsKIyBzY2hlbWUgYW5kIHBvcnQgZm9sbG93IEFQUF9fUFVCTElDX0JBU0VfVVJMLiBVbnNldCByZWZ1c2VzIHRoZSBib290LgojIERldmVsb3BtZW50OiBsdmgubWUsIGJyb3dzaW5nIHRoZSBhcHAgYXQgaHR0cDovL2FwcC5sdmgubWU6PHBvcnQ+IChucG0gcnVuIHNldHVwIHdyaXRlcyBib3RoKS4KQVBQX19QQUdFU19IT1NUPWx2aC5tZQpBUFBfX1BPUlQ9MzAzMAojIEFQUF9fSE9TVD0KQVBQX19ITVJfUE9SVD0KCiMgUGVyLXRva2VuIGFydGlmYWN0IGNhcDsgMCBkaXNhYmxlcyB0aGUgY2FwLgpRVU9UQV9fQVJUSUZBQ1RTX1BFUl9UT0tFTj0xMDAwCgojIFN0b3JlZCBhc3NldHMgcGVyIGFjY291bnQgKHVwbG9hZHMgKyBVUkxzIGltcG9ydGVkIGZpcnN0KSwgMTAgR0I7IGFub255bW91cyB0b2tlbnMgaGF2ZSB0aGVpciBvd24gY2FwLiAwIGRpc2FibGVzLgojIEFTU0VUU19fTUFYX0JZVEVTX1BFUl9UT0tFTj0xMDAwMDAwMDAwMAoKIyBMb2NhbCBkZXZlbG9wbWVudCB3cml0ZXMgbG9naW4gbWFpbCB0byAuYXJ0aWZhY3RiaW4vZGV2LW1haWwuanNvbmw7IHJlYWQgYSBjb2RlIHdpdGg6CiMgICBucG0gcnVuIGRldjpvdHAgLS0geW91QGV4YW1wbGUuY29tCiMgT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHN0YW5kYWxvbmUgcHJvY2Vzc2VzIGFuZCB0ZXN0IG9yY2hlc3RyYXRpb24uCiMgRU1BSUxfX0RFVl9PVVRCT1hfUEFUSD0KIyBQdWJsaWMgZW1haWwtY29kZSBsb2dpbiB1c2VzIGVpdGhlciBTTVRQIG9yIFJlc2VuZCB3aXRoIGFuIGF1dGhvcml6ZWQgc2VuZGVyLgpFTUFJTF9fUkVTRU5EX0FQSV9LRVk9CiMgU01UUCBhbHRlcm5hdGl2ZTogZGVmYXVsdCBwb3J0IDU4NyByZXF1aXJlcyBTVEFSVFRMUzsgc2VjdXJlPXRydWUgdXNlcyBpbXBsaWNpdCBUTFMgKGRlZmF1bHQgNDY1KS4KRU1BSUxfX1NNVFBfSE9TVD0KRU1BSUxfX1NNVFBfUE9SVD0KRU1BSUxfX1NNVFBfU0VDVVJFPQpFTUFJTF9fU01UUF9VU0VSPQpFTUFJTF9fU01UUF9QQVNTV09SRD0KRU1BSUxfX0ZST009YXJ0aWZhY3RiaW4gPGxvZ2luQGV4YW1wbGUuY29tPgoKIyBVbnNldCBTM19VUkwgc3RvcmVzIG9iamVjdHMgbG9jYWxseS4gUGVyY2VudC1lbmNvZGUgY3JlZGVudGlhbHMgaW4gUzMgVVJMcy4KIyBTM19VUkw9czM6Ly9LRVk6U0VDUkVUQHMzLnJlZ2lvbi5hbWF6b25hd3MuY29tL2J1Y2tldC9wcmVmaXg/cmVnaW9uPXJlZ2lvbgpPQkpFQ1RfU1RPUkVfX0xPQ0FMX0RJUj0uYXJ0aWZhY3Qtb2JqZWN0cwoKSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMDAKUERGX19NQVhfQllURVM9NTAwMDAwMDAKRklMRVNfX01BWF9CWVRFUz01MDAwMDAwMAoKIyBXZWIgaW1wb3J0cyBibG9jayBwcml2YXRlIG5ldHdvcmtzIGJ5IGRlZmF1bHQuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKClNRTF9fTUFYX1JPV1M9MTAwMDAKU1FMX19NQVhfUVVFUllfUk9XUz0xMDAwMApTUUxfX1FVRVJZX1RJTUVPVVRfTVM9NTAwMAoKIyBOdW1iZXIgb2YgdHJ1c3RlZCBmb3J3YXJkaW5nIGhvcHMgdXNlZCB0byBpbnRlcnByZXQgY2xpZW50IGFkZHJlc3Nlcy4KSFRUUF9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKCiMgT3B0aW9uYWwgZGVwbG95bWVudCBjb250cm9scy4KIyBBUlRJRkFDVFNfX0FMTE9XX1BVQkxJQz0xCiMgQW5vbnltb3VzIHVzZXIvZ3JvdXAgcHVibGlzaGluZyBob3N0cy4gT2ZmIGJ5IGRlZmF1bHQ7IGEgYmFyZSBob3N0bmFtZS4KIyBBUFBfX1VTRVJfUEFHRVNfSE9TVD11LmV4YW1wbGUuY29tCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNwbGl0LXNlcnZpY2UgZGVwbG95bWVudC4gSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUIG11c3QgbWF0Y2ggYWNyb3NzIGFwcCwgU1FMLCBicm93c2VyIGFuZCBldmVudHMuCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgT3B0aW9uYWwgZGlyZWN0IGV4cG9ydCB1cGxvYWQ7IGV4YWN0IFMzIG9yaWdpbiBhbmQgZXhwb3J0IG9iamVjdCBwcmVmaXggb25seS4KIyBCUk9XU0VSX19VUExPQURfT1JJR0lOPWh0dHBzOi8vYnVja2V0LnMzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tCiMgQlJPV1NFUl9fVVBMT0FEX1BSRUZJWD0vYXJ0aWZhY3RzL2V4cG9ydHMvb2JqZWN0cy8KIyBJbnRlcm5hbC1vbmx5IGJyb3dzZXJzIHJlYWNoIFMzIHRocm91Z2ggdGhlIHNjb3BlZCB1cGxvYWQgZ2F0ZXdheS4KIyBCUk9XU0VSX19VUExPQURfUFJPWFlfVVJMPWh0dHA6Ly91cGxvYWQtZ2F0ZXdheTo4MDgwCiMgQnJvd3NlciBzZXNzaW9ucyByZXF1aXJlIExpbnV4IGJ1YmJsZXdyYXAgd2l0aCB1bnByaXZpbGVnZWQgdXNlciBuYW1lc3BhY2VzLgojIERFVkVMT1BNRU5UIE9OTFkuIEJST1dTRVJfX1NBTkRCT1g9bm9uZSBydW5zIHRoZSBzZXNzaW9uIHdvcmtlciBhcyBhIHBsYWluIGNoaWxkCiMgcHJvY2Vzczogbm8gYnViYmxld3JhcCwgbm8gY2dyb3VwLCBOTyBPUyBjb250YWlubWVudCDigJQgYSBzZXNzaW9uIHNjcmlwdCB0aGVuIGhhcyB0aGUKIyB3aG9sZSBtYWNoaW5lLCB0aGlzIGNoZWNrb3V0IGFuZCB0aGUgbmV0d29yay4gSXQgZXhpc3RzIHNvIGxpdmUgc2Vzc2lvbnMgcnVuIG9uIGEKIyBtYWNPUyBkZXYgaG9zdCBhdCBhbGw7IGBucG0gcnVuIGRldmAgYWxyZWFkeSBkZWZhdWx0cyBpdCB0aGVyZS4gSXQgaXMgcmVmdXNlZCB3aGVuCiMgTk9ERV9FTlY9cHJvZHVjdGlvbiwgYW5kIGFueSBvdGhlciB2YWx1ZSBpcyByZWZ1c2VkIG91dHJpZ2h0LiBOZXZlciBzZXQgaXQgb24gYSBzZXJ2ZXIuCiMgQlJPV1NFUl9fU0FOREJPWD1ub25lCiMgU3BsaXQgYnJvd3NlciBzZXJ2aWNlOiB0cnVzdGVkIGFwcCBVUkw7IGFsc28gc2V0IEFQUF9fUFVCTElDX0JBU0VfVVJMLCBBUFBfX1BBR0VTX0hPU1QgYW5kIENPTlRSQUNUX19BQ1RPUl9TRUNSRVQgdGhlcmUuCiMgQlJPV1NFUl9fU0VTU0lPTl9BUFBfVVJMPWh0dHA6Ly9hcHA6ODA4MAojIFdyaXRhYmxlIGRlbGVnYXRlZCBjZ3JvdXAgdjIgc3VidHJlZSB3aXRoIGNwdSwgbWVtb3J5IGFuZCBwaWRzIGNvbnRyb2xsZXJzIGVuYWJsZWQuCiMgQlJPV1NFUl9fU0VTU0lPTl9DR1JPVVBfUk9PVD0vc3lzL2ZzL2Nncm91cC9hZmJpbi1zZXNzaW9ucwojIExpdmUgYnJvd3NlciBzZXNzaW9ucyB0aGlzIHNlcnZpY2UgaG9sZHMsIHNoYXJlZCBieSBldmVyeSBvd25lciwgYW5kIGhvdyBtYW55IG9uZQojIGNyZWRlbnRpYWwgbWF5IGhvbGQuIFdob2xlIG51bWJlcnMgb2YgYXQgbGVhc3QgMTsgZWFjaCBzZXNzaW9uIHN0aWxsIGdldHMgMSBHaUIuCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVg9MgojIEJST1dTRVJfX1NFU1NJT05fTUFYX1BFUl9BQ1RPUj0yCiMgQXV0aCBvd25lciBSUEMgb3JpZ2luIGZvciBzcGxpdC1ob3N0IGh1bWFuIHBhZ2VzIHNlc3Npb25zIChwcml2YXRlIHNlcnZpY2UgbmV0d29yaykuCiMgQVVUSF9fU0VSVklDRV9VUkw9aHR0cDovL2F1dGg6MzAwMAojIElOVEVSTkFMX19TRVJWSUNFX1NFQ1JFVD0KIyBTUUxfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9zcWw6ODA4MAojIEV2ZW50cyB1c2UgdGhlIGxvY2FsIGRhdGFiYXNlIHVubGVzcyBhbiBIVFRQIHNlcnZpY2UgVVJMIGlzIGNvbmZpZ3VyZWQuCiMgRVZFTlRTX19TRVJWSUNFX1VSTD1odHRwOi8vZXZlbnRzOjgwODAKIyBFVkVOVFNfX1NDSEVNQT1ldmVudHMKRVhQT1JUX19JTlRFUk5BTF9PUklHSU49CgojIE9wdGlvbmFsIGRhdGFiYXNlIHNjaGVtYSBuYW1lcy4KIyBBVVRIX19TQ0hFTUE9YXV0aAojIEFQUF9fU0NIRU1BPWFwcAoKIyBPcHRpb25hbCBHb29nbGUgbG9naW4uCiMgQVVUSF9fR09PR0xFX0NMSUVOVF9JRD0KIyBBVVRIX19HT09HTEVfQ0xJRU5UX1NFQ1JFVD0KCiMgT3B0aW9uYWwgT0lEQyBsb2dpbi4gVXNlIGV4cGxpY2l0IGVuZHBvaW50cyBvciBkaXNjb3ZlcnksIG5vdCBib3RoLgojIEFVVEhfX09JRENfUFJPVklERVJfSUQ9b2lkYwojIEFVVEhfX09JRENfQ0xJRU5UX0lEPQojIEFVVEhfX09JRENfQ0xJRU5UX1NFQ1JFVD0KIyBBVVRIX19PSURDX0FVVEhPUklaQVRJT05fVVJMPQojIEFVVEhfX09JRENfVE9LRU5fVVJMPQojIEFVVEhfX09JRENfVVNFUklORk9fVVJMPQojIEFVVEhfX09JRENfRElTQ09WRVJZX1VSTD0KCgoKCiMgUnVubmVyOiB1bnNldCBVUkwgdXNlcyB0aGUgbG9jYWwgc2VydmljZS4gUmVtb3RlIHJlcXVlc3RzIHJlcXVpcmUgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVC4KUlVOTkVSX19TRVJWSUNFX1VSTD0KIyBTZXQgYSBwaW5uZWQgd29ya2VyIGltYWdlIGZvciBEb2NrZXIgaXNvbGF0aW9uOyB1bnNldCB1c2VzIGEgbG9jYWwgY2hpbGQgcHJvY2Vzcy4KUlVOTkVSX19XT1JLRVJfSU1BR0U9ClJVTk5FUl9fTUFYX0NPTkNVUlJFTlQ9NAojIFN0YW5kYWxvbmUgcnVubmVyIGNvbnRyb2xsZXIgc2V0dGluZ3MuClJVTk5FUl9fUE9SVD0zMDUwClJVTk5FUl9fREFUQV9ESVI9Li9kYXRhL3J1bm5lcgpSVU5ORVJfX0FSVElGQUNUQklOX0JBU0VfVVJMPQojIERldmVsb3BtZW50IG9ubHk6IGB0cnVlYCBsZXRzIHJlc29sdmVyIGRhdGFiYXNlIGNvbm5lY3Rpb25zIHJlYWNoIGxvb3BiYWNrIHdpdGhvdXQgVExTLiBOZXZlciBpbiBwcm9kdWN0aW9uLgpSVU5ORVJfX0RBVEFCQVNFX0xPT1BCQUNLPQoKIyBDb21wYW55IGhvc3RpbmcgcmVxdWlyZXMgYSBkZXNpZ25hdGVkIHZlcmlmaWVkIGJvb3RzdHJhcCBvd25lci4KQVBQX19ERVBMT1lNRU5UX01PREU9cHVibGljCkFQUF9fREVQTE9ZTUVOVF9PV05FUl9FTUFJTD0KQVVUSF9fSU5WSVRFX09OTFk9dHJ1ZQpBVVRIX19BTExPV0VEX0VNQUlMX1BBVFRFUk5TPSoKIyBUZXN0LWRvbWFpbiBhY2NvdW50cyAoZG9jcy9vcGVyYXRpb25zLm1kKTogd2l0aCBib3RoIHNldCwgYW55IGFkZHJlc3MgYXQgZXhhY3RseSBURVNUX0RPTUFJTiBzaWducyBpbgojIHdpdGggVEVTVF9ET01BSU5fT1RQIGFuZCByZWNlaXZlcyBubyBtYWlsOyBzdWNoIGFjY291bnRzIGFyZSBtYXJrZWQgYW5kIGJveGVkIGluLiBFaXRoZXIgdW5zZXQgPSBvZmYuCiMgVEVTVF9ET01BSU5fT1RQOiAzMi0xMjggY2hhcmFjdGVycyBvZiBBLVogYS16IDAtOSAtIF8gKGUuZy4gb3BlbnNzbCByYW5kIC1oZXggMzIpLgojIFRFU1RfRE9NQUlOPQojIFRFU1RfRE9NQUlOX09UUD0K';
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
