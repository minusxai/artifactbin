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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgpBVVRIX19TRUNSRVQ9CgojIFVuc2V0IHVzZXMgZW1iZWRkZWQgUEdMaXRlIGF0IC4vZGF0YS9wZ2xpdGUuIEFsc28gYWNjZXB0cyBwZ2xpdGU6Ly9tZW1vcnkgb3IgUG9zdGdyZXMuCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovLy4vZGF0YS9wZ2xpdGUKCiMgUHVibGljIG9yaWdpbiBhbmQgbGlzdGVuaW5nIHBvcnQuIEFQUF9fSE1SX1BPUlQgZGVmYXVsdHMgdG8gQVBQX19QT1JUICsgMS4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2FwcC5sdmgubWU6MzAzMAojIE9wdGlvbmFsIGRlZGljYXRlZCBvcmlnaW4gdGhhdCBzZXJ2ZXMgb25seSBhbm9ueW1vdXMgY2FjaGVkIGJ5dGVzIGF0IC9hc3NldHMvKi4KIyBQcm9kdWN0aW9uIHJlcXVpcmVzIGEgZGlzdGluY3QgSFRUUFMgaG9zdG5hbWU7IEhUVFAgaXMgYWNjZXB0ZWQgb25seSBvbiBsb29wYmFjay4KIyBBUFBfX0FTU0VUU19PUklHSU49aHR0cHM6Ly9hc3NldHMuZXhhbXBsZS5jb20KIyBPdGhlciBvcmlnaW5zIHRoaXMgc2FtZSBkZXBsb3ltZW50IGFuc3dlcnMgYXQgKGEgbWFya2V0aW5nIGhvc3RuYW1lIHRoYXQgcHJveGllcwojIGhlcmUsIGEgcHJldmlvdXMgbmFtZSkuIENvbW1hLXNlcGFyYXRlZDsgSFRUUFMsIG9yIEhUVFAgb24gbG9vcGJhY2s7IG5vIHBhdGggb3IKIyBjcmVkZW50aWFscy4gU2VydmVkIGF0IEdFVCAvYXBpL3NlcnZlciwgc28gYWZiaW4gdHJlYXRzIGEgbGluayBvciBhIGZvbGRlciBmcm9tCiMgZWl0aGVyIG5hbWUgYXMgdGhpcyBzZXJ2ZXI7IHJlcXVlc3RzIGFuZCBjcmVkZW50aWFscyBzdGlsbCBnbyB0bwojIEFQUF9fUFVCTElDX0JBU0VfVVJMIGFsb25lLiBBIG1hbGZvcm1lZCBlbnRyeSByZWZ1c2VzIHRoZSBib290LgojIEFQUF9fQUxJQVNfT1JJR0lOUz1odHRwczovL2V4YW1wbGUuY29tCiMgUkVRVUlSRUQuIEV2ZXJ5IGRvY3VtZW50IGlzIHNlcnZlZCBvbiBpdHMgb3duIG9yaWdpbiwgPGhleCBpZD4uPHRoaXMgaG9zdD4sIGZyYW1lZCBieSB0aGUgYXBwIHBhZ2UuCiMgQSBiYXJlIGhvc3RuYW1lIHVuZGVyIHRoZSBhcHAncyByZWdpc3RyYWJsZSBkb21haW4gKHNhbWUgc2l0ZSksIGUuZy4gcGFnZXMuZXhhbXBsZS5jb207CiMgc2NoZW1lIGFuZCBwb3J0IGZvbGxvdyBBUFBfX1BVQkxJQ19CQVNFX1VSTC4gVW5zZXQgcmVmdXNlcyB0aGUgYm9vdC4KIyBEZXZlbG9wbWVudDogbHZoLm1lLCBicm93c2luZyB0aGUgYXBwIGF0IGh0dHA6Ly9hcHAubHZoLm1lOjxwb3J0PiAobnBtIHJ1biBzZXR1cCB3cml0ZXMgYm90aCkuCkFQUF9fUEFHRVNfSE9TVD1sdmgubWUKQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYXNzZXRzIHBlciBhY2NvdW50ICh1cGxvYWRzICsgVVJMcyBpbXBvcnRlZCBmaXJzdCksIDEwIEdCOyBhbm9ueW1vdXMgdG9rZW5zIGhhdmUgdGhlaXIgb3duIGNhcC4gMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49MTAwMDAwMDAwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgojIEVNQUlMX19ERVZfT1VUQk9YX1BBVEg9CiMgUHVibGljIGVtYWlsLWNvZGUgbG9naW4gdXNlcyBlaXRoZXIgU01UUCBvciBSZXNlbmQgd2l0aCBhbiBhdXRob3JpemVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQojIFNNVFAgYWx0ZXJuYXRpdmU6IGRlZmF1bHQgcG9ydCA1ODcgcmVxdWlyZXMgU1RBUlRUTFM7IHNlY3VyZT10cnVlIHVzZXMgaW1wbGljaXQgVExTIChkZWZhdWx0IDQ2NSkuCkVNQUlMX19TTVRQX0hPU1Q9CkVNQUlMX19TTVRQX1BPUlQ9CkVNQUlMX19TTVRQX1NFQ1VSRT0KRU1BSUxfX1NNVFBfVVNFUj0KRU1BSUxfX1NNVFBfUEFTU1dPUkQ9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAwClBERl9fTUFYX0JZVEVTPTUwMDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgTnVtYmVyIG9mIHRydXN0ZWQgZm9yd2FyZGluZyBob3BzIHVzZWQgdG8gaW50ZXJwcmV0IGNsaWVudCBhZGRyZXNzZXMuCkhUVFBfX1RSVVNURURfUFJPWFlfSE9QUz0xCgojIE9wdGlvbmFsIGRlcGxveW1lbnQgY29udHJvbHMuCiMgQVJUSUZBQ1RTX19BTExPV19QVUJMSUM9MQojIEN1c3RvbSBkb21haW5zIGZvciBwcm9maWxlczogdGhlIEROUyB0YXJnZXQgaG9zdG5hbWUgdXNlcnMgcG9pbnQgdGhlaXIgZG9tYWluIGF0CiMgKGEgQ05BTUUvQUxJQVMgdG8gaXQsIG9yIGFuIEEgcmVjb3JkIHRvIGl0cyBhZGRyZXNzKS4gVW5zZXQgb3IgZW1wdHkgdHVybnMgb2ZmCiMgYXR0YWNoaW5nIGFuZCB2ZXJpZnlpbmcgb25seTsgdmVyaWZpZWQgZG9tYWlucyBrZWVwIGJlaW5nIHNlcnZlZCBlaXRoZXIgd2F5LgojIEZMQUdfX0NVU1RPTV9ET01BSU5TPWRvbWFpbnMuZXhhbXBsZS5jb20KIyBBTkFMWVRJQ1NfX1NFQ1JFVD0KCiMgU3BsaXQtc2VydmljZSBkZXBsb3ltZW50LiBJTlRFUk5BTF9fU0VSVklDRV9TRUNSRVQgbXVzdCBtYXRjaCBhY3Jvc3MgYXBwLCBTUUwsIGJyb3dzZXIgYW5kIGV2ZW50cy4KIyBDT05UUkFDVF9fQUNUT1JfU0VDUkVUPQojIEJST1dTRVJfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9icm93c2VyOjgwODAKIyBPcHRpb25hbCBkaXJlY3QgZXhwb3J0IHVwbG9hZDsgZXhhY3QgUzMgb3JpZ2luIGFuZCBleHBvcnQgb2JqZWN0IHByZWZpeCBvbmx5LgojIEJST1dTRVJfX1VQTE9BRF9PUklHSU49aHR0cHM6Ly9idWNrZXQuczMudXMtd2VzdC0xLmFtYXpvbmF3cy5jb20KIyBCUk9XU0VSX19VUExPQURfUFJFRklYPS9hcnRpZmFjdHMvZXhwb3J0cy9vYmplY3RzLwojIEludGVybmFsLW9ubHkgYnJvd3NlcnMgcmVhY2ggUzMgdGhyb3VnaCB0aGUgc2NvcGVkIHVwbG9hZCBnYXRld2F5LgojIEJST1dTRVJfX1VQTE9BRF9QUk9YWV9VUkw9aHR0cDovL3VwbG9hZC1nYXRld2F5OjgwODAKIyBCcm93c2VyIHNlc3Npb25zIHJlcXVpcmUgTGludXggYnViYmxld3JhcCB3aXRoIHVucHJpdmlsZWdlZCB1c2VyIG5hbWVzcGFjZXMuCiMgREVWRUxPUE1FTlQgT05MWS4gQlJPV1NFUl9fU0FOREJPWD1ub25lIHJ1bnMgdGhlIHNlc3Npb24gd29ya2VyIGFzIGEgcGxhaW4gY2hpbGQKIyBwcm9jZXNzOiBubyBidWJibGV3cmFwLCBubyBjZ3JvdXAsIE5PIE9TIGNvbnRhaW5tZW50IOKAlCBhIHNlc3Npb24gc2NyaXB0IHRoZW4gaGFzIHRoZQojIHdob2xlIG1hY2hpbmUsIHRoaXMgY2hlY2tvdXQgYW5kIHRoZSBuZXR3b3JrLiBJdCBleGlzdHMgc28gbGl2ZSBzZXNzaW9ucyBydW4gb24gYQojIG1hY09TIGRldiBob3N0IGF0IGFsbDsgYG5wbSBydW4gZGV2YCBhbHJlYWR5IGRlZmF1bHRzIGl0IHRoZXJlLiBJdCBpcyByZWZ1c2VkIHdoZW4KIyBOT0RFX0VOVj1wcm9kdWN0aW9uLCBhbmQgYW55IG90aGVyIHZhbHVlIGlzIHJlZnVzZWQgb3V0cmlnaHQuIE5ldmVyIHNldCBpdCBvbiBhIHNlcnZlci4KIyBCUk9XU0VSX19TQU5EQk9YPW5vbmUKIyBTcGxpdCBicm93c2VyIHNlcnZpY2U6IHRydXN0ZWQgYXBwIFVSTDsgYWxzbyBzZXQgQVBQX19QVUJMSUNfQkFTRV9VUkwsIEFQUF9fUEFHRVNfSE9TVCBhbmQgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVCB0aGVyZS4KIyBCUk9XU0VSX19TRVNTSU9OX0FQUF9VUkw9aHR0cDovL2FwcDo4MDgwCiMgV3JpdGFibGUgZGVsZWdhdGVkIGNncm91cCB2MiBzdWJ0cmVlIHdpdGggY3B1LCBtZW1vcnkgYW5kIHBpZHMgY29udHJvbGxlcnMgZW5hYmxlZC4KIyBCUk9XU0VSX19TRVNTSU9OX0NHUk9VUF9ST09UPS9zeXMvZnMvY2dyb3VwL2FmYmluLXNlc3Npb25zCiMgTGl2ZSBicm93c2VyIHNlc3Npb25zIHRoaXMgc2VydmljZSBob2xkcywgc2hhcmVkIGJ5IGV2ZXJ5IG93bmVyLCBhbmQgaG93IG1hbnkgb25lCiMgY3JlZGVudGlhbCBtYXkgaG9sZC4gV2hvbGUgbnVtYmVycyBvZiBhdCBsZWFzdCAxOyBlYWNoIHNlc3Npb24gc3RpbGwgZ2V0cyAxIEdpQi4KIyBCUk9XU0VSX19TRVNTSU9OX01BWD0yCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVhfUEVSX0FDVE9SPTIKIyBBdXRoIG93bmVyIFJQQyBvcmlnaW4gZm9yIHNwbGl0LWhvc3QgaHVtYW4gcGFnZXMgc2Vzc2lvbnMgKHByaXZhdGUgc2VydmljZSBuZXR3b3JrKS4KIyBBVVRIX19TRVJWSUNFX1VSTD1odHRwOi8vYXV0aDozMDAwCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCiMgRXZlbnRzIHVzZSB0aGUgbG9jYWwgZGF0YWJhc2UgdW5sZXNzIGFuIEhUVFAgc2VydmljZSBVUkwgaXMgY29uZmlndXJlZC4KIyBFVkVOVFNfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9ldmVudHM6ODA4MAojIEVWRU5UU19fU0NIRU1BPWV2ZW50cwpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgT3B0aW9uYWwgZGF0YWJhc2Ugc2NoZW1hIG5hbWVzLgojIEFVVEhfX1NDSEVNQT1hdXRoCiMgQVBQX19TQ0hFTUE9YXBwCgojIE9wdGlvbmFsIEdvb2dsZSBsb2dpbi4KIyBBVVRIX19HT09HTEVfQ0xJRU5UX0lEPQojIEFVVEhfX0dPT0dMRV9DTElFTlRfU0VDUkVUPQoKIyBPcHRpb25hbCBPSURDIGxvZ2luLiBVc2UgZXhwbGljaXQgZW5kcG9pbnRzIG9yIGRpc2NvdmVyeSwgbm90IGJvdGguCiMgQVVUSF9fT0lEQ19QUk9WSURFUl9JRD1vaWRjCiMgQVVUSF9fT0lEQ19DTElFTlRfSUQ9CiMgQVVUSF9fT0lEQ19DTElFTlRfU0VDUkVUPQojIEFVVEhfX09JRENfQVVUSE9SSVpBVElPTl9VUkw9CiMgQVVUSF9fT0lEQ19UT0tFTl9VUkw9CiMgQVVUSF9fT0lEQ19VU0VSSU5GT19VUkw9CiMgQVVUSF9fT0lEQ19ESVNDT1ZFUllfVVJMPQoKCiMgUGVybWl0IFBvc3RncmVzIGNvbm5lY3Rpb25zIHRvIGxvb3BiYWNrL3ByaXZhdGUgbmV0d29ya3MgKHNlbGYtaG9zdGVkIGRlcGxveW1lbnRzIG9ubHkpLgojIExpbmstbG9jYWwsIG1ldGFkYXRhLCBtdWx0aWNhc3QgYW5kIHVuc3BlY2lmaWVkIGRlc3RpbmF0aW9ucyByZW1haW4gYmxvY2tlZC4KREFUQVNFVF9fQUxMT1dfUFJJVkFURV9ORVRXT1JLUz1mYWxzZQojIE9wdGlvbmFsIGNvbW1hLXNlcGFyYXRlZCBsaXRlcmFsIEROUyBzZXJ2ZXIgSVBzIGZvciBkYXRhc2V0IFBvc3RncmVTUUwgaG9zdCByZXNvbHV0aW9uIG9ubHkuCiMgRW1wdHkgdXNlcyB0aGUgb3BlcmF0aW5nIHN5c3RlbSByZXNvbHZlci4KREFUQVNFVF9fRE5TX1NFUlZFUlM9CiMgU0hBMjU2IGZpbmdlcnByaW50cyBvZiBleHBsaWNpdGx5IHJldmlld2VkIHByaXZhdGUgY29ubmVjdGlvbiB0dXBsZXMgKGRlZmF1bHQgZGVueSkuCiMgUGVybWl0cyBSRkMxOTE4L1VMQSBvbmx5OyBtZXRhZGF0YSwgbGluay1sb2NhbCBhbmQgbG9vcGJhY2sgc3RheSBmb3JiaWRkZW4uCkRBVEFTRVRfX1BSSVZBVEVfVEFSR0VUX0hBU0hFUz0KCgojIENMSS1vbmx5OiBnbG9iYWwgbnBtIGluc3RhbGxzIGF1dG9tYXRpY2FsbHkgdXBkYXRlIGFmdGVyIHN1Y2Nlc3NmdWwgY29ubmVjdGVkIGNvbW1hbmRzLgojIFVuc2V0L2ZhbHNlIGVuYWJsZXMgdXBkYXRlczsgdHJ1ZSBkaXNhYmxlcyB0aGVtLgojIENMSV9fRElTQUJMRV9BVVRPX1VQREFURVM9ZmFsc2UKIyBMZWdhY3kgQ0xJX19BVVRPX1VQREFURT0wIGFsc28gZGlzYWJsZXMgYXV0b21hdGljIHVwZGF0ZXMuCiMgQW4gZXhwbGljaXQgcGluIGRpc2FibGVzIHVwZGF0ZXM7IGNob29zZSB0aGUgc2FtZSBleGFjdCBwYWNrYWdlIHZlcnNpb24gaW4geW91ciBucHggY29tbWFuZC4KIyBDTElfX1ZFUlNJT05fUElOPQojIFNlcnZlcjogb24gYWR2ZXJ0aXNlcyB0aGUgQ0xJIHJldGlyZW1lbnQgcmVsZWFzZSAoMC42LjApLCBzbyBldmVyeSBjb25uZWN0ZWQgMC41LnggQ0xJIGluc3RhbGxzIGl0IGFuZCByZXRpcmVzLgojIFVuc2V0L29mZiBrZWVwcyBhZHZlcnRpc2luZyAwLjUuNTUuIFR1cm4gaXQgb24gb25seSBvbmNlIDAuNi4wIGlzIHB1Ymxpc2hlZCB0byBucG0uCiMgQ0xJX19SRVRJUkVNRU5UPW9mZgoKIyBSdW5uZXI6IHVuc2V0IFVSTCB1c2VzIHRoZSBsb2NhbCBzZXJ2aWNlLiBSZW1vdGUgcmVxdWVzdHMgcmVxdWlyZSBDT05UUkFDVF9fQUNUT1JfU0VDUkVULgpSVU5ORVJfX1NFUlZJQ0VfVVJMPQojIFNldCBhIHBpbm5lZCB3b3JrZXIgaW1hZ2UgZm9yIERvY2tlciBpc29sYXRpb247IHVuc2V0IHVzZXMgYSBsb2NhbCBjaGlsZCBwcm9jZXNzLgpSVU5ORVJfX1dPUktFUl9JTUFHRT0KUlVOTkVSX19NQVhfQ09OQ1VSUkVOVD00CiMgT3B0aW9uYWwgT3BlbkFJLWNvbXBhdGlibGUgZW5kcG9pbnQgYW5kIGhvc3Qtb25seSBrZXkgKGJsYW5rIGlzIHN1cHBvcnRlZCkuClJVTk5FUl9fT1BFTkFJX0JBU0VfVVJMPQpSVU5ORVJfX09QRU5BSV9BUElfS0VZPQpSVU5ORVJfX01PREVMPQojIEV4cGxpY2l0IGNvbXBsZXRpb24tbGltaXQgZmllbGQ6IG1heF9jb21wbGV0aW9uX3Rva2VucyAoT3BlbkFJKSwgbWF4X3Rva2VucyAoRmlyZXdvcmtzKS4KUlVOTkVSX19PVVRQVVRfVE9LRU5fRklFTEQ9bWF4X2NvbXBsZXRpb25fdG9rZW5zClJVTk5FUl9fTUFYX09VVFBVVF9UT0tFTlM9ODE5MgojIFN0YW5kYWxvbmUgcnVubmVyIGNvbnRyb2xsZXIgc2V0dGluZ3MuClJVTk5FUl9fUE9SVD0zMDUwClJVTk5FUl9fREFUQV9ESVI9Li9kYXRhL3J1bm5lcgpSVU5ORVJfX0FSVElGQUNUQklOX0JBU0VfVVJMPQoKIyBDb21wYW55IGhvc3RpbmcgcmVxdWlyZXMgYSBkZXNpZ25hdGVkIHZlcmlmaWVkIGJvb3RzdHJhcCBvd25lci4KQVBQX19ERVBMT1lNRU5UX01PREU9cHVibGljCkFQUF9fREVQTE9ZTUVOVF9PV05FUl9FTUFJTD0KQVVUSF9fSU5WSVRFX09OTFk9dHJ1ZQpBVVRIX19BTExPV0VEX0VNQUlMX1BBVFRFUk5TPSoKIyBUZXN0LWRvbWFpbiBhY2NvdW50cyAoZG9jcy9vcGVyYXRpb25zLm1kKTogd2l0aCBib3RoIHNldCwgYW55IGFkZHJlc3MgYXQgZXhhY3RseSBURVNUX0RPTUFJTiBzaWducyBpbgojIHdpdGggVEVTVF9ET01BSU5fT1RQIGFuZCByZWNlaXZlcyBubyBtYWlsOyBzdWNoIGFjY291bnRzIGFyZSBtYXJrZWQgYW5kIGJveGVkIGluLiBFaXRoZXIgdW5zZXQgPSBvZmYuCiMgVEVTVF9ET01BSU5fT1RQOiAzMi0xMjggY2hhcmFjdGVycyBvZiBBLVogYS16IDAtOSAtIF8gKGUuZy4gb3BlbnNzbCByYW5kIC1oZXggMzIpLgojIFRFU1RfRE9NQUlOPQojIFRFU1RfRE9NQUlOX09UUD0K';
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
