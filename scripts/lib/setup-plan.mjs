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
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGdlbmVyYXRlIGEgc2VjdXJlIGAuZW52YCBmb3IgdGhpcyBjaGVja291dC4KCiMgRW5hYmxlcyBvcGVyYXRpb25hbCB0b2tlbiBtaW50L3Jldm9rZSBlbmRwb2ludHMuIEdlbmVyYXRlIHdpdGg6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNpZ25zIGxvZ2luIHNlc3Npb25zLiBHZW5lcmF0ZSB3aXRoOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIFJlcXVpcmVkIGluIHByb2R1Y3Rpb24gYW5kIHN0YWJsZSBhY3Jvc3MgcmVzdGFydHM7IGRldmVsb3BtZW50IGdlbmVyYXRlcyBvbmUgcGVyIGJvb3Qgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBVbnNldCB1c2VzIGVtYmVkZGVkIFBHTGl0ZSBhdCAuL2RhdGEvcGdsaXRlLiBBbHNvIGFjY2VwdHMgcGdsaXRlOi8vbWVtb3J5IG9yIFBvc3RncmVzLgojIE9uZSBwcm9jZXNzIG93bnMgYSBQR0xpdGUgZGlyZWN0b3J5OyBzZXZlcmFsIHByb2Nlc3NlcyBtYXkgc2hhcmUgUG9zdGdyZXMgKGFuZCBtdXN0IHNoYXJlIG9uZSBvYmplY3Qgc3RvcmUpLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCgojIFB1YmxpYyBvcmlnaW4gYW5kIGxpc3RlbmluZyBwb3J0LiBBUFBfX0hNUl9QT1JUIGRlZmF1bHRzIHRvIEFQUF9fUE9SVCArIDEuCiMgQVBQX19QVUJMSUNfQkFTRV9VUkwgaXMgdGhlIG9uZSBjYW5vbmljYWwgb3JpZ2luIGV2ZXJ5IGxpbmsgaXMgbWludGVkIGZyb207IHJlcXVpcmVkIGluIHByb2R1Y3Rpb24uCiMgVGhlIHBvcnQgY29tZXMgZnJvbSBBUFBfX1BPUlQsIGVsc2UgdGhpcyBVUkwncyBwb3J0LCBlbHNlIDMwMzAuCkFQUF9fUFVCTElDX0JBU0VfVVJMPWh0dHA6Ly9hcHAubHZoLm1lOjMwMzAKIyBPcHRpb25hbCBkZWRpY2F0ZWQgb3JpZ2luIHRoYXQgc2VydmVzIG9ubHkgYW5vbnltb3VzIGNhY2hlZCBieXRlcyBhdCAvYXNzZXRzLyouCiMgUHJvZHVjdGlvbiByZXF1aXJlcyBhIGRpc3RpbmN0IEhUVFBTIGhvc3RuYW1lOyBIVFRQIGlzIGFjY2VwdGVkIG9ubHkgb24gbG9vcGJhY2suCiMgQVBQX19BU1NFVFNfT1JJR0lOPWh0dHBzOi8vYXNzZXRzLmV4YW1wbGUuY29tCiMgT3RoZXIgb3JpZ2lucyB0aGlzIHNhbWUgZGVwbG95bWVudCBhbnN3ZXJzIGF0IChhIG1hcmtldGluZyBob3N0bmFtZSB0aGF0IHByb3hpZXMKIyBoZXJlLCBhIHByZXZpb3VzIG5hbWUpLiBDb21tYS1zZXBhcmF0ZWQ7IEhUVFBTLCBvciBIVFRQIG9uIGxvb3BiYWNrOyBubyBwYXRoIG9yCiMgY3JlZGVudGlhbHMuIFNlcnZlZCBhdCBHRVQgL2FwaS9zZXJ2ZXIsIHNvIGFmYmluIHRyZWF0cyBhIGxpbmsgb3IgYSBmb2xkZXIgZnJvbQojIGVpdGhlciBuYW1lIGFzIHRoaXMgc2VydmVyOyByZXF1ZXN0cyBhbmQgY3JlZGVudGlhbHMgc3RpbGwgZ28gdG8KIyBBUFBfX1BVQkxJQ19CQVNFX1VSTCBhbG9uZS4gQSBtYWxmb3JtZWQgZW50cnkgcmVmdXNlcyB0aGUgYm9vdC4KIyBBUFBfX0FMSUFTX09SSUdJTlM9aHR0cHM6Ly9leGFtcGxlLmNvbQojIFRoZSBJUCBhZGRyZXNzZXMgdGhpcyBkZXBsb3ltZW50J3Mgb3V0Ym91bmQgdHJhZmZpYyBsZWF2ZXMgZnJvbSAocmVzb2x2ZXIgZGF0YWJhc2VzLCBjYXBzLmZldGNoLCB3ZWJob29rcykuCiMgQ29tbWEtc2VwYXJhdGVkIElQdjQgb3IgSVB2Njsgc2VydmVkIGF0IEdFVCAvYXBpL291dGJvdW5kLWlwcyBhbmQgc2hvd24gaW4gdGhlIFJlc29sdmVycyBwYW5lbCBzbyBvd25lcnMKIyBrbm93IHdoYXQgdG8gYWxsb3cgaW4gYSBkYXRhYmFzZSBmaXJld2FsbC4gVW5zZXQgc2VydmVzIGFuIGVtcHR5IGxpc3Q7IGEgbWFsZm9ybWVkIGVudHJ5IHJlZnVzZXMgdGhlIGJvb3QuCiMgQVBQX19PVVRCT1VORF9JUFM9MjAzLjAuMTEzLjEwCiMgUkVRVUlSRUQuIEV2ZXJ5IGRvY3VtZW50IGlzIHNlcnZlZCBvbiBpdHMgb3duIG9yaWdpbiwgPGhleCBpZD4uPHRoaXMgaG9zdD4sIGZyYW1lZCBieSB0aGUgYXBwIHBhZ2UuCiMgQSBiYXJlIGhvc3RuYW1lOyBzY2hlbWUgYW5kIHBvcnQgZm9sbG93IEFQUF9fUFVCTElDX0JBU0VfVVJMLiBVbnNldCByZWZ1c2VzIHRoZSBib290LiBPdmVyIGh0dHBzIGl0IG1heSBiZQojIGEgcmVnaXN0cmFibGUgZG9tYWluIG9mIGl0cyBvd24gKHJlY29tbWVuZGVkIGluIHByb2R1Y3Rpb247IHRoZSBmcmFtZSdzIGNvb2tpZSBpcyBTYW1lU2l0ZT1Ob25lOyBQYXJ0aXRpb25lZCksCiMgd2l0aCB3aWxkY2FyZCBETlMgYW5kIFRMUyBmb3IgKi48aG9zdD4uIE92ZXIgcGxhaW4gaHR0cCB0aGUgYXBwIG11c3QgYmUgb24gdGhlIHNhbWUgc2l0ZSAoU2FtZVNpdGU9TGF4KS4KIyBEZXZlbG9wbWVudDogbHZoLm1lLCBicm93c2luZyB0aGUgYXBwIGF0IGh0dHA6Ly9hcHAubHZoLm1lOjxwb3J0PiAobnBtIHJ1biBzZXR1cCB3cml0ZXMgYm90aCkuCkFQUF9fUEFHRVNfSE9TVD1sdmgubWUKQVBQX19QT1JUPTMwMzAKIyBBUFBfX0hPU1Q9CkFQUF9fSE1SX1BPUlQ9CgojIFBlci10b2tlbiBhcnRpZmFjdCBjYXA7IDAgZGlzYWJsZXMgdGhlIGNhcC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBTdG9yZWQgYXNzZXRzIHBlciBhY2NvdW50ICh1cGxvYWRzICsgVVJMcyBpbXBvcnRlZCBmaXJzdCksIDEwIEdCOyBhbm9ueW1vdXMgdG9rZW5zIGhhdmUgdGhlaXIgb3duIGNhcC4gMCBkaXNhYmxlcy4KIyBBU1NFVFNfX01BWF9CWVRFU19QRVJfVE9LRU49MTAwMDAwMDAwMDAKCiMgTG9jYWwgZGV2ZWxvcG1lbnQgd3JpdGVzIGxvZ2luIG1haWwgdG8gLmFydGlmYWN0YmluL2Rldi1tYWlsLmpzb25sOyByZWFkIGEgY29kZSB3aXRoOgojICAgbnBtIHJ1biBkZXY6b3RwIC0tIHlvdUBleGFtcGxlLmNvbQojIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBzdGFuZGFsb25lIHByb2Nlc3NlcyBhbmQgdGVzdCBvcmNoZXN0cmF0aW9uLgojIEVNQUlMX19ERVZfT1VUQk9YX1BBVEg9CiMgUHVibGljIGVtYWlsLWNvZGUgbG9naW4gdXNlcyBlaXRoZXIgU01UUCBvciBSZXNlbmQgd2l0aCBhbiBhdXRob3JpemVkIHNlbmRlci4KRU1BSUxfX1JFU0VORF9BUElfS0VZPQojIFNNVFAgYWx0ZXJuYXRpdmU6IGRlZmF1bHQgcG9ydCA1ODcgcmVxdWlyZXMgU1RBUlRUTFM7IHNlY3VyZT10cnVlIHVzZXMgaW1wbGljaXQgVExTIChkZWZhdWx0IDQ2NSkuCkVNQUlMX19TTVRQX0hPU1Q9CkVNQUlMX19TTVRQX1BPUlQ9CkVNQUlMX19TTVRQX1NFQ1VSRT0KRU1BSUxfX1NNVFBfVVNFUj0KRU1BSUxfX1NNVFBfUEFTU1dPUkQ9CkVNQUlMX19GUk9NPWFydGlmYWN0YmluIDxsb2dpbkBleGFtcGxlLmNvbT4KCiMgVW5zZXQgUzNfVVJMIHN0b3JlcyBvYmplY3RzIGxvY2FsbHkuIFBlcmNlbnQtZW5jb2RlIGNyZWRlbnRpYWxzIGluIFMzIFVSTHMuCiMgUzNfVVJMPXMzOi8vS0VZOlNFQ1JFVEBzMy5yZWdpb24uYW1hem9uYXdzLmNvbS9idWNrZXQvcHJlZml4P3JlZ2lvbj1yZWdpb24KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCklNQUdFU19fTUFYX0JZVEVTPTUwMDAwMDAwClBERl9fTUFYX0JZVEVTPTUwMDAwMDAwCkZJTEVTX19NQVhfQllURVM9NTAwMDAwMDAKCiMgV2ViIGltcG9ydHMgYmxvY2sgcHJpdmF0ZSBuZXR3b3JrcyBieSBkZWZhdWx0LgpXRUJfSU5HRVNUX19BTExPV19QUklWQVRFPTAKV0VCX0lOR0VTVF9fVElNRU9VVF9NUz0xMDAwMApXRUJfSU5HRVNUX19NQVhfUEVSX0hPVVI9MzAwCgpTUUxfX01BWF9ST1dTPTEwMDAwClNRTF9fTUFYX1FVRVJZX1JPV1M9MTAwMDAKU1FMX19RVUVSWV9USU1FT1VUX01TPTUwMDAKCiMgTnVtYmVyIG9mIHRydXN0ZWQgZm9yd2FyZGluZyBob3BzIGluIGZyb250IG9mIHRoaXMgYXBwOiB0aGV5IHNldCBYLUZvcndhcmRlZC1Gb3IvLUhvc3QvLVByb3RvLCByZWFkIHRoYXQgbWFueQojIGVudHJpZXMgZnJvbSB0aGUgZW5kLiAwOiBubyBwcm94eSwgc28gdGhvc2UgaGVhZGVycyBhcmUgaWdub3JlZCBhbmQgSG9zdCBpcyB0aGUgYWRkcmVzc2VkIGhvc3QgKGFub255bW91cwojIHJlYWRlcnMgdGhlbiBzaGFyZSBvbmUgcmF0ZS1saW1pdCBidWNrZXQ6IG5vIGFkZHJlc3MgaWRlbnRpZmllcyB0aGVtKS4KSFRUUF9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKCiMgT3B0aW9uYWwgZGVwbG95bWVudCBjb250cm9scy4KIyBBUlRJRkFDVFNfX0FMTE9XX1BVQkxJQz0xCiMgRGV2ZWxvcG1lbnQgYW5kIHRlc3Qgb25seTogbGV0IHBhZ2UgZnVuY3Rpb25zIGJlIHNjaGVkdWxlZCBtb3JlIG9mdGVuIHRoYW4gZXZlcnkgMTUgbWludXRlcyAod2hvbGUgbWludXRlcykuCiMgU0NIRURVTEVTX19NSU5fSU5URVJWQUxfTUlOVVRFUz0xCiMgQW5vbnltb3VzIHVzZXIvZ3JvdXAgcHVibGlzaGluZyBob3N0cy4gT2ZmIGJ5IGRlZmF1bHQ7IGEgYmFyZSBob3N0bmFtZS4gRWFjaCBsaXZlIHVzZXIgb3IgZ3JvdXAgaGFuZGxlCiMgKHVuZGVyc2NvcmVzIGJlY29tZSBoeXBoZW5zKSBnZXRzIDxoYW5kbGU+Ljx0aGlzIGhvc3Q+OiBwdWJsaWMgSFRNTCBvbiBpdHMgaG9tZSwgdW5saXN0ZWQgYnkgSUQgb25seSAobm9pbmRleCwKIyBuby1yZWZlcnJlcikuIEV2ZXJ5IHJlcXVlc3QgdGhlcmUgaXMgYSBndWVzdCdzLCBjb29raWVzIG9yIG5vdDogc3FsIHJlYWRzIGFuZCBHRVQgZnVuY3Rpb25zIG9ubHkuCiMgV2lsZGNhcmQgRE5TIGFuZCBUTFMgZm9yIGl0IGFyZSB0aGUgb3BlcmF0b3InczsgdGhlIHByb2R1Y3QgbmV2ZXIgcHJvdmlzaW9ucyBhIGhvc3RuYW1lLgojIEFQUF9fVVNFUl9QQUdFU19IT1NUPXUuZXhhbXBsZS5jb20KIyBBIGN1c3RvbSBzaGVsbDogb25lIEhUTUwgZmlsZSB0aGlzIHByb2Nlc3MgY2FuIHJlYWQsIHNlcnZlZCAoMjAwLCBuby1zdG9yZSwgdGhlIGFwcCdzIENTUCwgYSBMaW5rIHJlbD0iaGVscCIgdG8KIyAvbGxtcy50eHQpIGluIHBsYWNlIG9mIHRoZSBhcHAncyBvd24gc2NyZWVuczogZXhhY3RseSB0aGUgYWRkcmVzc2VzIHRoZSBVUkwgbWFwIGNhbGxzIHNjcmVlbnMgKC9hZi91cmwtc3BhY2UuanNvbiwKIyBjb250cmFjdHMgaXNTY3JlZW5QYXRoKTogLywgZXZlcnkgYXBwIHNjcmVlbiwgdGhlIHBhZ2UgYW5kIGhhbmRsZSBzY3JlZW5zIC9hLzxpZD4sIC9hLzxpZD4vZWRpdCwgL0A8aGFuZGxlPiBhbmQKIyAvQDxoYW5kbGU+LzxzbHVnPiwgL2xvZ2luIGZvciBhIGJyb3dzZXIgd2l0aG91dCBhIHNlc3Npb24gKHdpdGggb25lLCAvbG9naW4gc2VuZHMgaXQgdG8gaXRzIHNhbWUtb3JpZ2luIGNhbGxiYWNrVXJsKSwKIyBhbmQgZXZlcnkgYWRkcmVzcyB0aGUgYXBwIGRvZXMgbm90IG90aGVyd2lzZSBzZXJ2ZSwgc28gaXQgY2FuIHJvdXRlIGNsaWVudC1zaWRlLiBUaGUgYXBwIGtlZXBzIHRoZSByZXN0OiB0aGUgQVBJLAojIC9hZi8sIG9sZCBhZGRyZXNzZXMsIGV2ZXJ5IG90aGVyIGZpeGVkIHBhdGggKE9BdXRoIGFuZCBpdHMgY29uc2VudCBwYWdlLCAvbGxtcywgL3dlbGNvbWUsIC9zdGFydCwgL2xvY2FsL2Nvbm5lY3QsCiMgLi4uKSwgZXZlcnkgZG9vciB1bmRlciAvYS88aWQ+LywgdGhlIGluc3RhbGxlZCBhcHAgL2EvPGlkPi9hcHAvIGFuZCBleHBvcnQgY2FwdHVyZXMgKD9rZXk9KTsgaXRzIG90aGVyIHNjcmVlbnMgYXJlCiMgbm90IHJlYWNoYWJsZS4gX19DU1BfTk9OQ0VfXyBpbnNpZGUgYW4gYXR0cmlidXRlIHZhbHVlIChub25jZT0iLi4uIiwgYSBtZXRhIGNvbnRlbnQpIGJlY29tZXMgdGhlIHJlc3BvbnNlJ3Mgc2NyaXB0CiMgbm9uY2U7IHRoZSBmaXJzdCBfX0hFQURfVEFHU19fIHdyaXR0ZW4gYXMgbWFya3VwIGluc2lkZSA8aGVhZD4gYmVjb21lcyBhIGRvY3VtZW50J3Mgb3duIHRpdGxlLCBkZXNjcmlwdGlvbiBhbmQKIyBzb2NpYWwgY2FyZCB3aGVyZSBhbiBhbm9ueW1vdXMgcmVhZGVyIG1heSByZWFkIGl0IChlbHNlIG5vdGhpbmcpOyBhbnkgb3RoZXIgb2NjdXJyZW5jZSAoaW4gYSBzY3JpcHQsIHN0eWxlLAojIGNvbW1lbnQsIHRleHQgb3IgdGhlIGJvZHkpIHN0YXlzIGxpdGVyYWwuIFVucmVhZGFibGU6IG5vIGJvb3QuCiMgQVBQX19TSEVMTF9GSUxFPS9ldGMvYXJ0aWZhY3RiaW4vc2hlbGwuaHRtbAojIFNraWxsIGV4dHJhczogYSBmbGF0IGRpcmVjdG9yeSB0aGlzIHByb2Nlc3MgY2FuIHJlYWQgd2hvc2UgLm1kIGd1aWRlcywgLm1qcyBzY3JpcHRzIGFuZCAuanNvbiBmaWxlcyB0aGUgYXV0aG9yCiMgc2tpbGwgdGhpcyBvcmlnaW4gc2VydmVzICgvc2tpbGxzL2FydGlmYWN0YmluLnppcCkgY2FycmllcyB1bmRlciBleHRyYXMvLCB3aXRoIGEgZ2VuZXJhdGVkIGV4dHJhcy9SRUFETUUubWQgaW5kZXgKIyAoZWFjaCBndWlkZSBuZWVkcyBhICIjICIgaGVhZGluZzsgYSAiUmVhZCB3aGVuIC4uLiIgbGluZSBpcyBsaXN0ZWQgdG9vKS4gVGhleSBhcmUgb3BlcmF0b3IgaW5zdHJ1Y3Rpb25zIGFuZCBjb2RlCiMgc2hpcHBlZCB0byBhZ2VudHMsIGFuZCBwdWJsaWM6IG5vIHNlY3JldHMuIE5vIGhpZGRlbiBmaWxlcywgc3ViZGlyZWN0b3JpZXMgb3Igc3ltbGlua3M7IDMyIGZpbGVzLCA2NCBLaUIgZWFjaCwKIyAyNTYgS2lCIGluIGFsbC4gUmVhZCBhdCBib290OyBpbnZhbGlkOiBubyBib290LiBFbmFibGUgb25seSBvbmNlIGluc3RhbGxzIHJ1biBhbiB1cGRhdGVyIHRoYXQgYWNjZXB0cyBleHRyYXMvLgojIFNLSUxMU19fRVhUUkFfRElSPS9ldGMvYXJ0aWZhY3RiaW4vc2tpbGwtZXh0cmFzCiMgQU5BTFlUSUNTX19TRUNSRVQ9CgojIFNlcnZpY2VzIHRoYXQgYWNjZXB0IHRoaXMgaW5zdGFsbGF0aW9uJ3MgaWRlbnRpdHkgdG9rZW5zIChhbiBpZGVudGl0eS1zaWRlIHNldHRpbmc7IGVtcHR5IGJ5IGRlZmF1bHQpOiBlYWNoCiMgYW4gaWQsIHRoZSBvcmlnaW4gaXRzIHRva2VucyBhcmUgYm91bmQgdG8sIGFuZCBvcHRpb25hbGx5IHRoZSBTSEEtMjU2IChoZXgpIG9mIHRoZSBzZWNyZXQgaXQgaW50cm9zcGVjdHMgd2l0aAojIChQT1NUIC9hcGkvaW50ZXJuYWwvaWRlbnRpdHkvaW50cm9zcGVjdCwgYW5zd2VyaW5nIGl0IG9ubHkgZm9yIHRva2VucyBvZiBpdHMgb3duIGF1ZGllbmNlKS4gQSBwZXJzb24gc2lnbnMgaW4KIyBmb3Igb25lIHdpdGggYGF1dGgubWpzIGxvZ2luIC4uLiAtLWF1ZGllbmNlIElEYCAob3IgT0F1dGggd2l0aCByZXNvdXJjZT08b3JpZ2luPik7IGEgdG9rZW4gZm9yIGl0IGlzIG5ldmVyCiMgYWNjZXB0ZWQgYnkgdGhpcyBzZXJ2ZXIncyBBUEkuIEEgY2FsbGVyIGFscmVhZHkgaG9sZGluZyBhIGNyZWRlbnRpYWwgaGVyZSwgYSBzaWduZWQtaW4gcGFnZSAoc2FtZSBPcmlnaW4pIG9yIGFuCiMgb3JkaW5hcnkgQVBJIGJlYXJlciwgZXhjaGFuZ2VzIGl0IGZvciBhIDUtbWludXRlIHRva2VuIGZvciB0aGF0IHNlcnZpY2UsIG5vIHJlZnJlc2ggdG9rZW4sIGVuZGluZyB3aXRoIHRoYXQKIyBjcmVkZW50aWFsOiBQT1NUIC9hcGkvYXV0aGVudGljYXRpb24vc2VydmljZS10b2tlbiB7ImF1ZGllbmNlIjoiPGlkPiJ9LiAoL2FwaS9hdXRoZW50aWNhdGlvbi90b2tlbiwgdGhlIGxvbmcKIyBncmFudCwgcmVmdXNlcyBhbnkgcmVxdWVzdCBhIHBhZ2UgbWFrZXMuKSBTZXQgaXQgb24gdGhlIGFwcCBhbmQgb24gYSBzZXBhcmF0ZSBhdXRoIGhvc3QgYWxpa2UuCiMgSURFTlRJVFlfX1NFUlZJQ0VfQVVESUVOQ0VTPVt7ImlkIjoid2FyZWhvdXNlIiwib3JpZ2luIjoiaHR0cHM6Ly9kYXRhLmV4YW1wbGUuY29tIiwiaW50cm9zcGVjdGlvbl9zZWNyZXRfc2hhMjU2IjoiPDY0IGhleD4ifV0KIyBPQXV0aCBjbGllbnRzIHRoZSBvcGVyYXRvciByZWdpc3RlcnMgKHB1YmxpYywgUEtDRSwgbm8gc2VjcmV0KTogYSBmaXhlZCBpZCBhbmQgcmVkaXJlY3RzIChodHRwcywgb3IgaHR0cCBvbiBhCiMgbG9jYWwgZGV2ZWxvcG1lbnQgaG9zdCksIGFuZCBhIG5hbWUgcGVvcGxlIHNlZSBhdCBjb25zZW50LCBlLmcuIGEgc2VydmljZSdzIHdlYiBhcHBsaWNhdGlvbiBzaWduaW5nIGJyb3dzZXJzIGluCiMgKHJlc291cmNlPTxpdHMgb3JpZ2luPiwgb3IgdGhpcyBBUEkpLiAiZmlyc3RfcGFydHkiOiB0cnVlIG1ha2VzIGl0IHBhcnQgb2YgdGhpcyBkZXBsb3ltZW50J3Mgc2lnbi1pbjogbm8gY29uc2VudAojIHBhZ2UsIGFuZCBpdHMgZ3JhbnRzIGVuZCB3aGVuIHRoZSBicm93c2VyIHNlc3Npb24gdGhhdCBhcHByb3ZlZCB0aGVtIGVuZHMgKHNpZ24tb3V0KS4KIyBJREVOVElUWV9fT0FVVEhfQ0xJRU5UUz1beyJjbGllbnRfaWQiOiJ3YXJlaG91c2Utd2ViIiwibmFtZSI6IldhcmVob3VzZSIsInJlZGlyZWN0X3VyaXMiOlsiaHR0cHM6Ly9kYXRhLmV4YW1wbGUuY29tL2F1dGgvY2FsbGJhY2siXSwiZmlyc3RfcGFydHkiOnRydWV9XQojIERhdGEgc2VydmljZXMgYSBwYWdlIGZ1bmN0aW9uJ3MgJ3ZpZXdlcicgY29ubmVjdGlvbiBtYXkgYmUgYm91bmQgdG86IGVhY2ggaWQsIGl0cyBzZXNzaW9uIGVuZHBvaW50IGFuZCB0aGUKIyBJREVOVElUWV9fU0VSVklDRV9BVURJRU5DRVMgaWQgaXRzIHZpZXdlciB0b2tlbnMgYXJlIG1pbnRlZCBmb3IuIEVtcHR5OiBhICd2aWV3ZXInIGRlY2xhcmF0aW9uIHJlZnVzZXMgcHVibGlzaC4KIyBBIHBhZ2UgcnVuIGNvbm5lY3RzIHRvIHRoZSBlbmRwb2ludCBhIHNlc3Npb24gbmFtZXMsIHdpdGggdGhlIFRMUyBtb2RlIGl0IG5hbWVzLCB1bmRlciB0aGUgcnVsZSBldmVyeSByZXNvbHZlcgojIGRhdGFiYXNlIG1lZXRzOiBhIHB1YmxpYyBhZGRyZXNzIChhbiBJUCBsaXRlcmFsIG9yIGEgbmFtZSBvZiB0d28gb3IgbW9yZSBsYWJlbHMpIG92ZXIgVExTOyBhIGxvb3BiYWNrLAojIHBsYWludGV4dCBlbmRwb2ludCBpcyByZWFjaGVkIG9ubHkgd2l0aCBSVU5ORVJfX0RBVEFCQVNFX0xPT1BCQUNLPXRydWUgKGRldmVsb3BtZW50IGFuZCB0ZXN0cykuCiMgREFUQV9TRVJWSUNFU19fVFJVU1RFRD1beyJpZCI6IndhcmVob3VzZSIsInNlc3Npb25fdXJsIjoiaHR0cHM6Ly9kYXRhLmV4YW1wbGUuY29tL3Nlc3Npb25zIiwiYXVkaWVuY2UiOiJ3YXJlaG91c2UifV0KIyBUaGUgaW5zdGFsbCdzIGRlZmF1bHQgY29ubmVjdGlvbjogb25lIGNvbm5lY3RvciBjb25maWd1cmF0aW9uIChwb3N0Z3JlcywgbXlzcWw7IHNlY3JldHMgaW5jbHVkZWQpLCB3aGljaCBldmVyeQojIHNpZ25lZC1pbiBwZXJzb24gbWF5IHF1ZXJ5IHJlYWQtb25seSwgZnJvbSBhIHBhZ2UgKDxsaW5rIHJlbD0iYWYtZGF0YXNldCIgZGF0YS1hZi1uYW1lPSJOQU1FIiBocmVmPSJkZWZhdWx0OkRCIj4sCiMgREIgdGhlIGRhdGFiYXNlIHRoZSBzZXNzaW9uIG9wZW5zLCBhcyB3cml0dGVuOyBTUUwgbmFtaW5nIE5BTUUudGFibGUpIG9yIGFuIGFnZW50IChzcWwubWpzIHF1ZXJ5IGRlZmF1bHQ6REIpLgojIEdpdmUgdGhlIGFjY291bnQgcmVhZC1vbmx5IGdyYW50cy4gInRscyI6ICJ2ZXJpZnktZnVsbCIgKHRoZSBkZWZhdWx0OyAiY2EiOiBhIFBFTSBidW5kbGUgZm9yIGEgcHJpdmF0ZSByb290KSBvcgojICJkaXNhYmxlIi4gRWFjaCBzdGF0ZW1lbnQgbmFtZXMgaXRzIHJlYWRlciBpbnNpZGUgaXRzIG93biByZWFkLW9ubHkgdHJhbnNhY3Rpb24gKGFwcC52aWV3ZXJfaWQsIGFwcC52aWV3ZXJfZW1haWwsCiMgYXBwLnZpZXdlcl9ncm91cHM7IE15U1FMIEBhcHAudmlld2VyXyopOiBhZHZpc29yeSBvbiBhIHBsYWluIGRhdGFiYXNlLCBzaW5jZSBhIHJlYWRlcidzIFNRTCBjb3VsZCBjaGFuZ2UgdGhlbS4KIyBTaG93biBvbiB0aGUgc2V0dGluZ3MgcGFnZSB3aXRob3V0IHRoZSB1c2VyIG9yIHBhc3N3b3JkLiBJbnZhbGlkOiBubyBib290ICh0aGUgZXJyb3IgbmFtZXMgdGhpcyBzZXR0aW5nLCBuZXZlcgojIHRoZSB2YWx1ZSkuCiMgREFUQVNFVFNfX0RFRkFVTFRfQ09OTkVDVElPTj17ImNvbm5lY3RvciI6InBvc3RncmVzIiwiaG9zdCI6ImRiLmV4YW1wbGUuY29tIiwiZGF0YWJhc2UiOiJzaG9wIiwidXNlciI6InJlYWRlciIsInBhc3N3b3JkIjoiLi4uIn0KIyAxIGxldHMgY29ubmVjdGlvbnMgcmVhY2ggbG9vcGJhY2sgYW5kIHByaXZhdGUgYWRkcmVzc2VzIGFuZCB0dXJuIFRMUyBvZmYgKCJ0bHMiOiJkaXNhYmxlIiksIGZvciBkZXZlbG9wbWVudCBvciBhCiMgZGF0YWJhc2Ugb24gdGhpcyBpbnN0YWxsJ3Mgb3duIG5ldHdvcms7IDAgKHRoZSBkZWZhdWx0KTogcHVibGljIGFkZHJlc3NlcyBvdmVyIHZlcmlmaWVkIFRMUyBvbmx5LiBMaW5rLWxvY2FsIGFuZAojIGNsb3VkIG1ldGFkYXRhIGFkZHJlc3NlcyBhcmUgcmVmdXNlZCBlaXRoZXIgd2F5LgojIERBVEFTRVRTX19BTExPV19QUklWQVRFX05FVFdPUks9MAojIFBhZ2UtZnVuY3Rpb24gc2NoZWR1bGVzOiBvbiAodGhlIGRlZmF1bHQpIG9yIG9mZiAodGhlIHNjaGVkdWxlciBpcyBub3Qgc3RhcnRlZCBhbmQgYSBzYXZlIHRoYXQgd291bGQgc3RhcnQgYQojIHBhZ2Ugc2NoZWR1bGUgaXMgcmVmdXNlZCB3aXRoIHBhZ2Vfc2NoZWR1bGVzX2Rpc2FibGVkOyBvbi1kZW1hbmQgZnVuY3Rpb25zIGFyZSB1bmFmZmVjdGVkKS4KIyBTQ0hFRFVMRVNfX1BBR0VfU0NIRURVTEVTPW9uCiMgT3JpZ2lucyAoaHR0cHMsIG9yIGh0dHAgb24gYSBsb2NhbCBkZXZlbG9wbWVudCBob3N0KSBhbGxvd2VkIHRvIGZyYW1lIGEgZG9jdW1lbnQncyBhZGRyZXNzOiB0aGUgL2EvPGlkPiBhcHAKIyBwYWdlIGFuZCB0aGUgZG9jdW1lbnQgaXQgZnJhbWVzLiBPbmx5IHRoZXkgbWF5IGZyYW1lIGl0cyBlbWJlZGRlZCB2aWV3ICgvYS88aWQ+P2VtYmVkPTEsIG5vIGFwcCBiYXIpLiBFbXB0eToKIyBmcmFtZWQgYnkgdGhlIGFwcCBhbG9uZS4KIyBFTUJFRF9fVFJVU1RFRF9PUklHSU5TPQojIEdyb3VwIGFwcHJvdmFsIG9mIHRoZSBhZGRyZXNzZXMgYSBwYWdlIG1heSBjYWxsOiBvbiAodGhlIGRlZmF1bHQpIG9yIG9mZi4gT24sIGEgZ3JvdXAncyBlZGl0b3JzIG1heSBhcHByb3ZlIGFuCiMgZXhhY3QgaHR0cHMgb3JpZ2luIGEgcGFnZSBkZWNsYXJlcyBmb3IgY29ubmVjdCwgaW1nIG9yIG1lZGlhIChuZXZlciBzY3JpcHQsIHN0eWxlIG9yIGZyYW1lLCBuZXZlciBhIHdpbGRjYXJkKSwgYW5kCiMgZXZlcnkgbWVtYmVyIG9mIHRoZSBncm91cCBhbmQgaXRzIHN1Ymdyb3VwcyBpcyB0aGVuIG5vdCBhc2tlZCBhYm91dCBpdCBvbiBhbnkgcGFnZS4gT2ZmOiBub3Qgb2ZmZXJlZCwgdGhlIGdyb3VwCiMgYWRkcmVzc2VzIEFQSSBhbnN3ZXJzIGdyb3VwX2FwcHJvdmFsc19kaXNhYmxlZCwgYW5kIHN0b3JlZCBhcHByb3ZhbHMgYXJlIGlnbm9yZWQgKGtlcHQsIG5vdCBkZWxldGVkKS4KIyBUUlVTVF9fR1JPVVBfQVBQUk9WQUxTPW9uCgojIFNwbGl0LXNlcnZpY2UgZGVwbG95bWVudC4gSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUIG11c3QgbWF0Y2ggYWNyb3NzIGFwcCwgU1FMLCBicm93c2VyIGFuZCBldmVudHMuCiMgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVD0KIyBCUk9XU0VSX19TRVJWSUNFX1VSTD1odHRwOi8vYnJvd3Nlcjo4MDgwCiMgT3B0aW9uYWwgZGlyZWN0IGV4cG9ydCB1cGxvYWQ6IHRoZSBicm93c2VyIHNlcnZpY2UgUFVUcyBlYWNoIHJlbmRlcmVkIGltYWdlIHRvIHRoZSBhcHAncyBzaWduZWQgVVJMIGl0c2VsZi4KIyBUaGUgZXhhY3QgSFRUUFMgb3JpZ2luIHRoZSBhcHAncyBzaWduZXIgZW1pdHMsIGFuZCB0aGUgYWJzb2x1dGUgcGF0aCBlbmRpbmcgaW4gL2V4cG9ydHMvb2JqZWN0cy8gKHBhdGgtc3R5bGUKIyBzdG9yYWdlIHB1dHMgdGhlIGJ1Y2tldCBpbiB0aGUgcGF0aCB0b28pLiBUaGUgdXBsb2FkIGdhdGV3YXkgZ2V0cyB0aGUgc2FtZSB0d28gdmFsdWVzIGFuZCBubyBTMyBjcmVkZW50aWFscy4KIyBCUk9XU0VSX19VUExPQURfT1JJR0lOPWh0dHBzOi8vYnVja2V0LnMzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tCiMgQlJPV1NFUl9fVVBMT0FEX1BSRUZJWD0vYXJ0aWZhY3RzL2V4cG9ydHMvb2JqZWN0cy8KIyBJbnRlcm5hbC1vbmx5IGJyb3dzZXJzIHJlYWNoIFMzIHRocm91Z2ggdGhlIHNjb3BlZCB1cGxvYWQgZ2F0ZXdheSAoc2VydmljZXMvYnJvd3Nlci9zcmMvdXBsb2FkLWdhdGV3YXktc2VydmVyLnRzKSwKIyB3aGljaCBqb2lucyB0aGUgY29tcHV0ZSBhbmQgZWdyZXNzIG5ldHdvcmtzLCBwdWJsaXNoZXMgbm8gcG9ydCwgYWRtaXRzIG9ubHkgYm91bmRlZCBQTkcgYW5kIEpQRUcgUFVUcyB0byB0aGF0CiMgb3JpZ2luIGFuZCBwcmVmaXgsIGFuZCBmb2xsb3dzIG5vIHJlZGlyZWN0LgojIEJST1dTRVJfX1VQTE9BRF9QUk9YWV9VUkw9aHR0cDovL3VwbG9hZC1nYXRld2F5OjgwODAKIyBCcm93c2VyIHNlc3Npb25zIHJlcXVpcmUgTGludXggYnViYmxld3JhcCB3aXRoIHVucHJpdmlsZWdlZCB1c2VyIG5hbWVzcGFjZXMuCiMgREVWRUxPUE1FTlQgT05MWS4gQlJPV1NFUl9fU0FOREJPWD1ub25lIHJ1bnMgdGhlIHNlc3Npb24gd29ya2VyIGFzIGEgcGxhaW4gY2hpbGQKIyBwcm9jZXNzOiBubyBidWJibGV3cmFwLCBubyBjZ3JvdXAsIE5PIE9TIGNvbnRhaW5tZW50IOKAlCBhIHNlc3Npb24gc2NyaXB0IHRoZW4gaGFzIHRoZQojIHdob2xlIG1hY2hpbmUsIHRoaXMgY2hlY2tvdXQgYW5kIHRoZSBuZXR3b3JrLiBJdCBleGlzdHMgc28gbGl2ZSBzZXNzaW9ucyBydW4gb24gYQojIG1hY09TIGRldiBob3N0IGF0IGFsbDsgYG5wbSBydW4gZGV2YCBhbHJlYWR5IGRlZmF1bHRzIGl0IHRoZXJlLiBJdCBpcyByZWZ1c2VkIHdoZW4KIyBOT0RFX0VOVj1wcm9kdWN0aW9uLCBhbmQgYW55IG90aGVyIHZhbHVlIGlzIHJlZnVzZWQgb3V0cmlnaHQuIE5ldmVyIHNldCBpdCBvbiBhIHNlcnZlci4KIyBCUk9XU0VSX19TQU5EQk9YPW5vbmUKIyBTcGxpdCBicm93c2VyIHNlcnZpY2U6IHRydXN0ZWQgYXBwIFVSTDsgYWxzbyBzZXQgQVBQX19QVUJMSUNfQkFTRV9VUkwsIEFQUF9fUEFHRVNfSE9TVCBhbmQgQ09OVFJBQ1RfX0FDVE9SX1NFQ1JFVCB0aGVyZS4KIyBCUk9XU0VSX19TRVNTSU9OX0FQUF9VUkw9aHR0cDovL2FwcDo4MDgwCiMgV3JpdGFibGUgZGVsZWdhdGVkIGNncm91cCB2MiBzdWJ0cmVlIHdpdGggY3B1LCBtZW1vcnkgYW5kIHBpZHMgY29udHJvbGxlcnMgZW5hYmxlZC4KIyBCUk9XU0VSX19TRVNTSU9OX0NHUk9VUF9ST09UPS9zeXMvZnMvY2dyb3VwL2FmYmluLXNlc3Npb25zCiMgTGl2ZSBicm93c2VyIHNlc3Npb25zIHRoaXMgc2VydmljZSBob2xkcywgc2hhcmVkIGJ5IGV2ZXJ5IG93bmVyLCBhbmQgaG93IG1hbnkgb25lCiMgY3JlZGVudGlhbCBtYXkgaG9sZC4gV2hvbGUgbnVtYmVycyBvZiBhdCBsZWFzdCAxOyBlYWNoIHNlc3Npb24gc3RpbGwgZ2V0cyAxIEdpQi4KIyBCUk9XU0VSX19TRVNTSU9OX01BWD0yCiMgQlJPV1NFUl9fU0VTU0lPTl9NQVhfUEVSX0FDVE9SPTIKIyBBdXRoIG93bmVyIFJQQyBvcmlnaW4gZm9yIHNwbGl0LWhvc3QgaHVtYW4gcGFnZXMgc2Vzc2lvbnMgKHByaXZhdGUgc2VydmljZSBuZXR3b3JrKS4KIyBBVVRIX19TRVJWSUNFX1VSTD1odHRwOi8vYXV0aDozMDAwCiMgSU5URVJOQUxfX1NFUlZJQ0VfU0VDUkVUPQojIFNRTF9fU0VSVklDRV9VUkw9aHR0cDovL3NxbDo4MDgwCiMgRXZlbnRzIHVzZSB0aGUgbG9jYWwgZGF0YWJhc2UgdW5sZXNzIGFuIEhUVFAgc2VydmljZSBVUkwgaXMgY29uZmlndXJlZC4KIyBFVkVOVFNfX1NFUlZJQ0VfVVJMPWh0dHA6Ly9ldmVudHM6ODA4MAojIEVWRU5UU19fU0NIRU1BPWV2ZW50cwpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgT3B0aW9uYWwgZGF0YWJhc2Ugc2NoZW1hIG5hbWVzLiBBVVRIX19TQ0hFTUEgYWxzbyBob2xkcyB0aGUgaWRlbnRpdHkgbW9kdWxlJ3MgdGFibGVzICh1c2VycywgdG9rZW5zLAojIGdyb3VwcyDigKYpOyBJREVOVElUWV9fU0NIRU1BIGlzIHRoZSBpZGVudGl0eSByZWFkIHZpZXdzIGV2ZXJ5IHJlYWRlciAodGhpcyBhcHAsIG90aGVyIHNlcnZpY2VzKSByZWFkcyB0aGVtIHRocm91Z2guCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAKIyBJREVOVElUWV9fU0NIRU1BPWlkZW50aXR5CgojIE9wdGlvbmFsIEdvb2dsZSBsb2dpbi4KIyBBVVRIX19HT09HTEVfQ0xJRU5UX0lEPQojIEFVVEhfX0dPT0dMRV9DTElFTlRfU0VDUkVUPQoKIyBPcHRpb25hbCBPSURDIGxvZ2luLiBVc2UgZXhwbGljaXQgZW5kcG9pbnRzIG9yIGRpc2NvdmVyeSwgbm90IGJvdGguCiMgQVVUSF9fT0lEQ19QUk9WSURFUl9JRD1vaWRjCiMgQVVUSF9fT0lEQ19DTElFTlRfSUQ9CiMgQVVUSF9fT0lEQ19DTElFTlRfU0VDUkVUPQojIEFVVEhfX09JRENfQVVUSE9SSVpBVElPTl9VUkw9CiMgQVVUSF9fT0lEQ19UT0tFTl9VUkw9CiMgQVVUSF9fT0lEQ19VU0VSSU5GT19VUkw9CiMgQVVUSF9fT0lEQ19ESVNDT1ZFUllfVVJMPQoKCgoKIyBSdW5uZXI6IHVuc2V0IFVSTCB1c2VzIHRoZSBsb2NhbCBzZXJ2aWNlLiBSZW1vdGUgcmVxdWVzdHMgcmVxdWlyZSBDT05UUkFDVF9fQUNUT1JfU0VDUkVULgpSVU5ORVJfX1NFUlZJQ0VfVVJMPQojIFNldCBhIHBpbm5lZCB3b3JrZXIgaW1hZ2UgZm9yIERvY2tlciBpc29sYXRpb247IHVuc2V0IHVzZXMgYSBsb2NhbCBjaGlsZCBwcm9jZXNzLgpSVU5ORVJfX1dPUktFUl9JTUFHRT0KUlVOTkVSX19NQVhfQ09OQ1VSUkVOVD00CiMgU3RhbmRhbG9uZSBydW5uZXIgY29udHJvbGxlciBzZXR0aW5ncy4KUlVOTkVSX19QT1JUPTMwNTAKUlVOTkVSX19EQVRBX0RJUj0uL2RhdGEvcnVubmVyClJVTk5FUl9fQVJUSUZBQ1RCSU5fQkFTRV9VUkw9CiMgRGV2ZWxvcG1lbnQgb25seTogYHRydWVgIGxldHMgcmVzb2x2ZXIgZGF0YWJhc2UgY29ubmVjdGlvbnMgcmVhY2ggbG9vcGJhY2sgd2l0aG91dCBUTFMuIE5ldmVyIGluIHByb2R1Y3Rpb24uClJVTk5FUl9fREFUQUJBU0VfTE9PUEJBQ0s9CgojIENvbXBhbnkgaG9zdGluZyByZXF1aXJlcyBhIGRlc2lnbmF0ZWQgdmVyaWZpZWQgYm9vdHN0cmFwIG93bmVyLgpBUFBfX0RFUExPWU1FTlRfTU9ERT1wdWJsaWMKQVBQX19ERVBMT1lNRU5UX09XTkVSX0VNQUlMPQpBVVRIX19JTlZJVEVfT05MWT10cnVlCkFVVEhfX0FMTE9XRURfRU1BSUxfUEFUVEVSTlM9KgojIFRlc3QtZG9tYWluIGFjY291bnRzIGZvciBhdXRvbWF0ZWQgcnVucyAodGhlIGFnZW50IGV2YWxzKTogd2l0aCBib3RoIHNldCwgYW55IGFkZHJlc3MgYXQgZXhhY3RseSBURVNUX0RPTUFJTgojIChub3QgYSBzdWJkb21haW4gb3IgYSBsb29rLWFsaWtlKSBzaWducyBpbiB3aXRoIFRFU1RfRE9NQUlOX09UUCB0aHJvdWdoIHRoZSBub3JtYWwgbG9naW4gYW5kIHJlY2VpdmVzIG5vIG1haWw7CiMgdGhlIGNvZGUgaXMgc2luZ2xlIHVzZSB3aXRoIGZpdmUgYXR0ZW1wdHMgYW5kIHRoZSB1c3VhbCByYXRlIGxpbWl0cy4gTmV3IHJvd3MgYXJlIG1hcmtlZCB1c2Vycy50ZXN0X2FjY291bnQgYW5kCiMgYm94ZWQgaW4gKHNlcnZpY2VzL2FwcC9saWIvYWNjb3VudHMvdGVzdC1hY2NvdW50cy50cykuIEVpdGhlciB1bnNldCA9IG9mZjsgYW4gaW52YWxpZCBwYWlyIGlzIG9mZiBhbmQgbG9nZ2VkLgojIFRoZSBpZGVudGl0eSBzZXJ2aWNlIGFuZCB0aGUgYXBwIGJvdGggcmVhZCB0aGUgcGFpcjogZ2l2ZSBhIHNwbGl0IGRlcGxveW1lbnQgdGhlIHNhbWUgdmFsdWVzIGluIGJvdGguCiMgVEVTVF9ET01BSU5fT1RQOiAzMi0xMjggY2hhcmFjdGVycyBvZiBBLVogYS16IDAtOSAtIF8gKGUuZy4gb3BlbnNzbCByYW5kIC1oZXggMzIpLgojIFRFU1RfRE9NQUlOPQojIFRFU1RfRE9NQUlOX09UUD0K';
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
