/**
 * Pure setup planning: the questions, CLI contract, validation, and rendered
 * environment file. The runner owns every side effect.
 *
 * The example is snapshotted because the runtime image deliberately contains
 * only the two setup modules; decoding this constant is deterministic and
 * keeps this module free of filesystem I/O.
 */

const DEFAULT_PUBLIC_URL = 'http://localhost:3030';

// Keep this snapshot byte-for-byte aligned with .env.example.
const ENV_EXAMPLE_BASE64 = 'IyBSdW4gYG5wbSBydW4gc2V0dXBgIHRvIGNyZWF0ZSBgLmVudmAgZm9yIHRoaXMgY2hlY2tvdXQuCiMgSXQgZ2VuZXJhdGVzIHNlY3VyZSBBVVRIX19TRUNSRVQgYW5kIEFETUlOX19TRUNSRVQgdmFsdWVzIGZvciB5b3UuCgojIFNoYXJlZCBzZWNyZXQgZm9yIGFkbWluLW1pbnRpbmcvcmV2b2tpbmcgdG9rZW5zIChQT1NUIC9hcGkvdG9rZW5zKS4KIyBJZiB1bnNldCwgdGhvc2UgYWRtaW4gZW5kcG9pbnRzIGFuc3dlciA0MDQuIChBbm9ueW1vdXMgbWludGluZyB2aWEKIyAvYXBpL3Rva2Vucy9hbm9ueW1vdXMgd29ya3MgcmVnYXJkbGVzcy4pCiMgR2VuZXJhdGU6IG9wZW5zc2wgcmFuZCAtYmFzZTY0IDMyCkFETUlOX19TRUNSRVQ9CgojIFNlY3JldCBmb3Igc2lnbmluZyBsb2dpbiBzZXNzaW9uIEpXVHMuIEdlbmVyYXRlOiBvcGVuc3NsIHJhbmQgLWJhc2U2NCAzMgojIEZhbGxzIGJhY2sgdG8gYW4gaW5zZWN1cmUgZGV2LW9ubHkgdmFsdWUgd2hlbiB1bnNldC4KQVVUSF9fU0VDUkVUPQoKIyBUSEUgZGF0YWJhc2UgZW52IOKAlCB0aGUgVVJMIGlzIHRoZSB0eXBlLiBVbnNldDogZW1iZWRkZWQgUEdMaXRlIGF0CiMgLi9kYXRhL3BnbGl0ZSAoemVyby1jb25maWc7IGV4YWN0bHkgT05FIHNlcnZlciBwcm9jZXNzIG1heSBvd24gdGhhdAojIGRpcmVjdG9yeSDigJQgc2VlIFJFQURNRSkuIFVuZGVyIGRvY2tlciBjb21wb3NlLCB1bnNldCBtZWFucyB0aGUgYnVuZGxlZAojIHBvc3RncmVzIHNlcnZpY2UuIFRoZSBpZGVtcG90ZW50IGJvb3QgRERMIGFwcGxpZXMgdG8gd2hhdGV2ZXIgdGhpcyBwb2ludHMKIyBhdCDigJQgeW91ciBVUkwsIHlvdXIgZGF0YWJhc2UsIHlvdXIgc2NoZW1hLgojIERBVEFCQVNFX1VSTD1wZ2xpdGU6Ly8uL2RhdGEvcGdsaXRlCiMgREFUQUJBU0VfVVJMPXBnbGl0ZTovL21lbW9yeQojIERBVEFCQVNFX1VSTD1wb3N0Z3Jlc3FsOi8vdXNlcjpwYXNzQGhvc3Q6NTQzMi9hcnRpZmFjdF9iaW4KCiMgVXNlZCBvbmx5IGJ5IGBucG0gcnVuIG1pbnRgIHRvIHJlYWNoIHRoZSBydW5uaW5nIHNlcnZlci4KIyBVbnNldCwgaXQgZm9sbG93cyBQVUJMSUNfQkFTRV9VUkwuCiMgQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCgojIFRoZSBleHRlcm5hbGx5IHZpc2libGUgb3JpZ2luIChhYnNvbHV0ZSBVUkxzIGluIE1DUCB0b29sIHJlc3BvbnNlcykuCiMgU2V0IHRvIHlvdXIgcmVhbCBodHRwcyBvcmlnaW4gaW4gcHJvZHVjdGlvbi4KIyBJbiBkZXYgdGhpcyBBTFNPIHBpY2tzIHRoZSBwb3J0IGBucG0gcnVuIGRldmAgYmluZHMg4oCUIGNoYW5nZSBpdCBoZXJlIChhbmQKIyBub3RoaW5nIGVsc2UpIHRvIHJ1biBhIHNlY29uZCBjaGVja291dCBiZXNpZGUgdGhlIGZpcnN0LiBQT1JUIG92ZXJyaWRlcyBpdDsKIyBhIFVSTCB3aXRoIG5vIHBvcnQgbWVhbnMgMzAzMC4KQVBQX19QVUJMSUNfQkFTRV9VUkw9aHR0cDovL2xvY2FsaG9zdDozMDMwCgojIEhvc3QgcG9ydCBjb21wb3NlIHB1Ymxpc2hlcyB0aGUgYXBwIG9uLCBhbmQg4oCUIHNldCBoZXJlIOKAlCB0aGUgcG9ydCBgbnBtIHJ1bgojIGRldmAgYmluZHMsIG92ZXJyaWRpbmcgdGhlIG9uZSBpbiBQVUJMSUNfQkFTRV9VUkwuIERlZmF1bHQgMzAzMCBlaXRoZXIgd2F5LAojIHNvIHRoZSB0d28gYXJlIGludGVyY2hhbmdlYWJsZTsgb25seSBvbmUgY2FuIHJ1biBhdCBhIHRpbWUuIExlYXZlIGl0IHVuc2V0IHRvCiMgbGV0IFBVQkxJQ19CQVNFX1VSTCBhbG9uZSBkZWNpZGUgdGhlIGRldiBwb3J0LCBvciB0aGUgbGlua3MgdGhlIGFwcCBlbWl0cyBhbmQKIyB0aGUgcG9ydCBpdCBsaXN0ZW5zIG9uIGNhbiBkaXNhZ3JlZSAoZGV2IHdhcm5zIHdoZW4gdGhleSBkbykuCkFQUF9fUE9SVD0zMDMwCgojIEludGVyZmFjZSB0aGUgc3RhbmRhbG9uZSBwcm94eSBiaW5kczsgYmxhbmsgYmluZHMgYWxsIGludGVyZmFjZXMgKGRlZmF1bHQpLgojIEFQUF9fSE9TVD0gICAgICAgICAgICAgICAgICAgICAgICAjIGJsYW5rID0gZXZlcnkgaW50ZXJmYWNlICh0aGUgZGVmYXVsdCk7IHNldCB0byBiaW5kIG9uZQoKIyBWaXRlJ3MgZGV2LW9ubHkgSE1SIHdlYnNvY2tldCBwb3J0LiBVbnNldCBkZWZhdWx0cyB0byBBUFBfX1BPUlQgKyAxLgpBUFBfX0hNUl9QT1JUPQoKIyBQZXItdG9rZW4gYXJ0aWZhY3QgY2FwOyBjcmVhdGlvbiBhbnN3ZXJzIDQwMyBxdW90YV9leGNlZWRlZCBhdCB0aGUgY2FwLgojIDAgZGlzYWJsZXMuIERlZmF1bHQgMTAwMC4KUVVPVEFfX0FSVElGQUNUU19QRVJfVE9LRU49MTAwMAoKIyBSRVFVSVJFRCBmb3IgYWNjb3VudHMuIExvZ2luIGlzIGVtYWlsICsgYSBvbmUtdGltZSBjb2RlLCBzbyB0aGUgYXBwIGNhbm5vdAojIHNpZ24gYW55b25lIGluIHdpdGhvdXQgYSB3YXkgdG8gc2VuZCBtYWlsLiBUaGVyZSBpcyBkZWxpYmVyYXRlbHkgTk8gZmFsbGJhY2sKIyB0aGF0IHByaW50cyB0aGUgY29kZSB0byB0aGUgbG9nIOKAlCB0aGF0IHdvdWxkIGJlIGFuIGF1dGggYnlwYXNzIGZvciBhbnlvbmUgd2hvCiMgY2FuIHJlYWQgbG9ncy4gR2V0IGEga2V5IGF0IHJlc2VuZC5jb20gYW5kIHZlcmlmeSB0aGUgc2VuZGluZyBkb21haW4uCkVNQUlMX19SRVNFTkRfQVBJX0tFWT0KCiMgU2VuZGVyIGZvciBsb2dpbiBjb2Rlcy4gTXVzdCBiZSBhIGRvbWFpbiB2ZXJpZmllZCBpbiBSZXNlbmQgb3Igc2VuZHMgZmFpbC4KRU1BSUxfX0ZST009YXJ0aWZhY3QtYmluIDxsb2dpbkB2ZXJpZnkuYXJ0aWZhY3RiaW4uZGV2PgoKIyBSZXNlbmQgQVBJIGJhc2Ug4oCUIHRoZSBPTkUgd2F5IHRvIHJlYWQgYSBsb2dpbiBjb2RlLCBzaW5jZSBub3RoaW5nIGluIHRoZSBhcHAKIyBldmVyIGV4cG9zZXMgb25lLiBQb2ludCBpdCBhdCBhIGxvY2FsIHNpbmsgYW5kIHRoZSByZWFsIHNlbmQgcGF0aCBwb3N0cyB0aGUKIyBlbWFpbCB0aGVyZSBhcyBKU09OIGluc3RlYWQgKHNjcmlwdHMvbGliL21haWwtbG9naW4ubWpzKS4gRWFjaCBnYXRlIGJpbmRzIGl0cwojIG93biBzaW5rIHBvcnQsIHNvIHBvaW50IHRoaXMgYXQgdGhlIGZhbi1vdXQgcmVsYXkgYW5kIG9uZSByZXN0YXJ0IGNvdmVycyBhbGwKIyBvZiB0aGVtOiAgbm9kZSBzY3JpcHRzL2xpYi9tYWlsLXJlbGF5Lm1qcwpFTUFJTF9fUkVTRU5EX0JBU0VfVVJMPWh0dHA6Ly8xMjcuMC4wLjE6NDYwMAoKIyBPYmplY3Qgc3RvcmFnZSBmb3IgZGF0YXNldCByb3dzLCBhcyBPTkUgY29ubmVjdGlvbiBzdHJpbmc6IGNyZWRlbnRpYWxzLAojIGJ1Y2tldCBhbmQgdG9wLWxldmVsIGZvbGRlciB0b2dldGhlci4gUGVyY2VudC1lbmNvZGUgdGhlIHNlY3JldCDigJQgZ2VuZXJhdGVkCiMgb25lcyBjb250YWluIC8gKyBhbmQgPS4KIyAgIHMzOi8vS0VZOlNFQ1JFVEBzMy48cmVnaW9uPi5hbWF6b25hd3MuY29tLzxidWNrZXQ+Lzxmb2xkZXI+P3JlZ2lvbj08cmVnaW9uPgojIFVuc2V0LCBkYXRhc2V0cyBmYWxsIGJhY2sgdG8gdGhlIGxvY2FsIGZpbGVzeXN0ZW0gKExPQ0FMX09CSkVDVF9ESVIpLCBzbyBhCiMgbGFwdG9wIGFuZCBDSSBuZWVkIG5vIGV4dGVybmFsIHNlcnZpY2Ug4oCUIHRoZSBzYW1lIHByb21pc2UgUEdMaXRlIG1ha2VzLgojIFMzX1VSTD0KT0JKRUNUX1NUT1JFX19MT0NBTF9ESVI9LmFydGlmYWN0LW9iamVjdHMKCiMgTWF4aW11bSBieXRlcyBhY2NlcHRlZCBmb3Igb25lIHVwbG9hZGVkIGltYWdlLiBEZWZhdWx0IDUsMDAwLDAwMC4KSU1BR0VTX19NQVhfQllURVM9NTAwMDAwMAoKIyBXZWItaW1wb3J0IHNhZmV0eS9jYXBhY2l0eSBjb250cm9sczogcHJpdmF0ZSBuZXR3b3JrcyBzdGF5IGJsb2NrZWQgYnkgZGVmYXVsdDsKIyByZXF1ZXN0cyB0aW1lIG91dCBhZnRlciAxMHM7IG9uZSBpZGVudGl0eSBnZXRzIDMwMCBhdHRlbXB0cy9ob3VyOyBvbmUgcHVibGlzaCBpbXBvcnRzIGF0IG1vc3QgOCBpbWFnZXMuCldFQl9JTkdFU1RfX0FMTE9XX1BSSVZBVEU9MApXRUJfSU5HRVNUX19USU1FT1VUX01TPTEwMDAwCldFQl9JTkdFU1RfX01BWF9QRVJfSE9VUj0zMDAKV0VCX0lOR0VTVF9fTUFYX0lNQUdFU19QRVJfUFVCTElTSD04CgojIFJvd3Mga2VwdCBmcm9tIGEgZGF0YSBzb3VyY2UuIEEgZGF0YXNldCBpcyBhIFNBTVBMRSB1bnRpbCB0aGVyZSBpcyBhIHF1ZXJ5CiMgbGF5ZXI6IDIwMGsgcm93cyBpbXBvcnQgZmluZSBhbmQgdGhlbiBtYWtlIGFuIHVubG9hZGFibGUgcGFnZSwgYmVjYXVzZSBldmVyeQojIHJvdyBpcyBmZXRjaGVkLCBwYXJzZWQgYW5kIHNlcmlhbGl6ZWQgaW50byB0aGUgZG9jdW1lbnQuIFRoZSB0cnVlIHJvdyBjb3VudCBpcwojIGFsd2F5cyByZXBvcnRlZCwgc28gdHJ1bmNhdGlvbiBpcyBuZXZlciBzaWxlbnQuClNRTF9fTUFYX1JPV1M9MTAwMDAKCiMgUm93cyBvbmUgU1FMIHF1ZXJ5IG1heSByZXR1cm4gKGRlZmF1bHRzIHRvIFNRTF9fTUFYX1JPV1MpIGFuZCBpdHMgNXMgdGltZW91dC4KU1FMX19NQVhfUVVFUllfUk9XUz0xMDAwMApTUUxfX1FVRVJZX1RJTUVPVVRfTVM9NTAwMAoKIyBBbm9ueW1vdXMtbWludCBjZWlsaW5nLCBwZXIgSVAgcGVyIGhvdXIgKFBPU1QgL2FwaS90b2tlbnMvYW5vbnltb3VzIGFuZCB0aGUKIyBPQXV0aCBndWVzdCBncmFudCkuIFRoZSB3aW5kb3cgaXMgaW4tbWVtb3J5LCBzbyBhIHJlc3RhcnQgYWxzbyBjbGVhcnMgaXQuCiMgRGVmYXVsdCAxMCBmb3IgYSByZWFsIGRlcGxveW1lbnQ7IGBuZXh0IGRldmAgZGVmYXVsdHMgaGlnaCBpbnN0ZWFkLCBiZWNhdXNlCiMgdGhlIGJyb3dzZXIgZ2F0ZXMgbWludCBvbiBldmVyeSBydW4gYW5kIHdvdWxkIG90aGVyd2lzZSBleGhhdXN0IHRoZSBob3VyLgojIFNldHRpbmcgaXQgaGVyZSB3aW5zIGluIGJvdGguClJBVEVfTElNSVRFUl9fQU5PTl9NSU5UX01BWD0xMAoKIyBIb3cgbWFueSBwcm94aWVzIHNpdCBpbiBmcm9udCBvZiB0aGlzIGFwcC4gWC1Gb3J3YXJkZWQtRm9yIGlzIGEgbGlzdCBlYWNoIGhvcAojIEFQUEVORFMgdG8sIHNvIHRoZSBhZGRyZXNzIHlvdXIgb3V0ZXJtb3N0IFRSVVNURUQgcHJveHkgc2F3IGlzIHRoaXMgbWFueQojIGVudHJpZXMgZnJvbSB0aGUgRU5EIOKAlCBldmVyeXRoaW5nIGxlZnQgb2YgaXQgaXMgdGV4dCB0aGUgQ0FMTEVSIHNlbnQsIGFuZAojIHJlYWRpbmcgdGhhdCBlbmQgbGV0cyBhIGNhbGxlciBwaWNrIHRoZWlyIG93biByYXRlLWxpbWl0IGJ1Y2tldC4KIyBEZWZhdWx0IDEgPSB0aGUgc2luZ2xlIFRMUy10ZXJtaW5hdGluZyBwcm94eSBkb2NrZXItY29tcG9zZS55bWwgYXNzdW1lcy4KIyBTZXQgMiBpZiB5b3UgYWRkIGEgQ0ROIGluIGZyb250IG9mIHRoYXQgcHJveHkuIE5ldmVyIHNldCBpdCBoaWdoZXIgdGhhbiB0aGUKIyBudW1iZXIgb2YgaG9wcyB0aGF0IGFjdHVhbGx5IHJld3JpdGUgdGhlIGhlYWRlci4KUkFURV9MSU1JVEVSX19UUlVTVEVEX1BST1hZX0hPUFM9MQoKIyBUdXJuIHRoZSBQUkVWSUVXIGZlYXR1cmVzIG9uIGZvciB0aGlzIHdob2xlIGRlcGxveW1lbnQgKGxpYi9mZWF0dXJlcy8pLgojIFVuc2V0LCB0aGV5IGFyZSBvcHQtaW4gcGVyIFJFUVVFU1Qgd2l0aCBgP3Y9MmAg4oCUIHRoZSBmbGFnIGxpdmVzIGluIHRoZSBVUkwKIyBhbmQgbm93aGVyZSBlbHNlLCBhbmQgdGhlIGFwcCBjYXJyaWVzIGl0IG9udG8gaXRzIG93biAvYXBpLyBjYWxscyBhbmQgbGlua3MuCiMgQSBzdGFnaW5nIGJveCBzZXRzIHRoaXM7IHByb2R1Y3Rpb24gbGVhdmVzIGl0IGFsb25lIHVudGlsIGEgZmVhdHVyZSBzaGlwcy4KIyBUb2RheSdzIHByZXZpZXdzOiB3cml0YWJsZS1kYXRhc2V0cy4KUFJFVklFV19fRkVBVFVSRVM9MQoKIyBIb3cgbWFueSBkYXRhc2V0IHdyaXRlcyBPTkUgVklTSVRPUiBtYXkgbWFrZSBwZXIgbWludXRlIHRocm91Z2ggZG9jdW1lbnRzCiMgKFBPU1QgL2EvPGlkPi9tdXRhdGUsIGtleWVkIGJ5IGNsaWVudCBJUCkuIEEgcHVibGljIHdyaXRhYmxlIGRhdGFzZXQgYmVoaW5kIGEKIyBwdWJsaWMgZG9jdW1lbnQgaXMgYW4gb3BlbiBpbmJveCBieSBkZXNpZ24g4oCUIHRoYXQgaXMgd2hhdCBhIHBvbGwgSVMg4oCUIGFuZAojIHRoaXMgaXMgd2hhdCBrZWVwcyBvbmUgc2NyaXB0IGZyb20gZmlsbGluZyBpdC4gV2VsbCBjbGVhciBvZiBhIGh1bWFuIGNsaWNraW5nLgpSQVRFX0xJTUlURVJfX01VVEFURV9NQVg9NjAKCiMg4pSA4pSAIE5hbWVzcGFjZWQgbmFtZXMgKE1PRFVMRV9fTkFNRSkg4oCUIHRoZSBvbmx5IHNwZWxsaW5nIHRoZXJlIGlzLiBBIHJldGlyZWQKIyBmbGF0IG5hbWUgaXMgbm90IHJlYWQ7IHRoZSBzZXJ2ZXIgbmFtZXMgaXQgYW5kIGl0cyByZXBsYWNlbWVudCBhdCBib290LiDilIDilIDilIDilIAKIyBSQVRFIExJTUlURVIg4oCUIGV2ZXJ5IGRvb3IgaGFzIHRoZSBzYW1lIGZvdXIga25vYnM6IF9NQVgsIF9XSU5ET1cgKHNlY29uZHMpLAojIF9CVVJTVCAodGhlIG11bHRpcGxpZXIgYSBjcmVkZW50aWFsZWQgY2FsbGVyIGdldHMgb24gdGhlIFNBTUUgYnVja2V0KSwgX0tFWQojIChpcCB8IGFjdG9yIHwgaXArYWN0b3IpLiBEb29yczogR0xPQkFMIEFOT05fTUlOVCBMT0dJTl9TRU5EIExPR0lOX1ZFUklGWQojIFBVQkxJU0ggRURJVCBNVVRBVEUgUVVFUlkgRVhQT1JUIEVWRU5UU19TVFJFQU1TIE9BVVRIX1RPS0VOLgojIEFub255bW91cyBtaW50aW5nIGlzIENMT1NFRCBieSBkZWZhdWx0ICgwL2hvdXIpIOKAlCBhIHNlbGYtaG9zdGVyIHdobyBjaGFuZ2VzCiMgbm90aGluZyBuZXZlciBoYXMgc3RyYW5nZXJzIG1pbnRpbmcgb24gdGhlaXIgYm94LiBUaGUgcHVibGljIGRlcGxveW1lbnQgb3BlbnMgaXQ6CiMgUkFURV9MSU1JVEVSX19BTk9OX01JTlRfTUFYPTEwCiMgUkFURV9MSU1JVEVSX19BTk9OX01JTlRfQlVSU1Q9NQojIFJBVEVfTElNSVRFUl9fTVVUQVRFX01BWD02MAojIFJBVEVfTElNSVRFUl9fVFJVU1RFRF9QUk9YWV9IT1BTPTEKIyBgcHVibGljYCB2aXNpYmlsaXR5IChsaXN0aW5nIG9uIHByb2ZpbGVzKSBpcyBPRkYgYnkgZGVmYXVsdDsgYHVubGlzdGVkYCBhbHJlYWR5CiMgZ2l2ZXMgImFueW9uZSB3aXRoIHRoZSBsaW5rIi4gVGhlIHB1YmxpYyBkZXBsb3ltZW50IHR1cm5zIGl0IG9uOgojIEFSVElGQUNUU19fQUxMT1dfUFVCTElDPTEKIyBUaGUgYW5hbHl0aWNzIHZpc2l0b3IgZmluZ2VycHJpbnQncyBvd24gc2VjcmV0IChkZWZhdWx0cyB0byBBVVRIX19TRUNSRVQpOgojIEFOQUxZVElDU19fU0VDUkVUPQojIFRoZSBicm93c2VyIHNlcnZpY2UgZm9yIGV4cG9ydCAoc2VydmljZXMvYnJvd3NlciwgYW4gSFRUUCBzZXJ2aWNlKTsgdW5zZXQgPSBDaHJvbWl1bSBpbiB0aGlzIHByb2Nlc3M6CiMgQlJPV1NFUl9fU0VSVklDRV9VUkw9aHR0cDovL2Jyb3dzZXI6ODA4MAojIEFVVEggKHRoZSBwcm94eSdzIGh1bWFuIGxvZ2luIOKAlCBCZXR0ZXIgQXV0aDogZW1haWwgY29kZSwgR29vZ2xlLCBhbnkgT0lEQyBJZFApCiMgQVVUSF9fU0VDUkVUPSAgICAgICAgICAgICAgICAgICAgICAjIHNlc3Npb24gc2lnbmluZzsgYWxzbyBzaWducyB0aGUgYWdlbnQgY29va2llLiBTZXQgaXQ6IGEgZ2VuZXJhdGVkIG9uZSBmb3JnZXRzIGV2ZXJ5IHNlc3Npb24gb24gcmVzdGFydC4KCiMgV2hlcmUgaWRlbnRpdHkncyB0YWJsZXMgbGl2ZSAoQmV0dGVyIEF1dGg6IHVzZXIsIHNlc3Npb24sIGFjY291bnQsCiMgdmVyaWZpY2F0aW9uKS4gYGF1dGhgIHVubGVzcyBzZXQuIEEgZGVwbG95bWVudCB0aGF0IHNoYXJlcyBPTkUgZGF0YWJhc2UKIyBiZXR3ZWVuIHByb2R1Y3RzIOKAlCBhIHNjaGVtYSBlYWNoIOKAlCBuYW1lcyBpdHMgb3duIGhlcmUsIHNvIGEgc2Vjb25kIHRlbmFudCdzCiMgaWRlbnRpdHkgdGFibGVzIG5ldmVyIGFwcGVhciB1bmRlcm5lYXRoIGl0LiBQbGFpbiBpZGVudGlmaWVyIG9ubHkuCiMgQVVUSF9fU0NIRU1BPWF1dGgKIyBBUFBfX1NDSEVNQT1hcHAgICAgICAgICAgICAgICAgICAgIyBhcHAgdGFibGVzIHRoZSBwcm94eSdzIHRva2VuIHJlYWRlciBhZGRyZXNzZXMKIyBQUk9YWV9fU0VDVVJFX0NPT0tJRVM9ICAgICAgICAgICAgIyBkZWZhdWx0OiB0cnVlIGZvciBhbiBodHRwcyBwdWJsaWMgVVJMLCBvdGhlcndpc2UgZmFsc2UKIyBVUFNUUkVBTV9fREVBRExJTkVfTVM9MzAwMDAgICAgICAgICMgdGhlIHN0YW5kYWxvbmUgcHJveHkncyB3YWl0IGZvciB0aGUgdXBzdHJlYW0ncyBzdGF0dXMraGVhZGVyczsgYSBzdHJlYW1pbmcgYm9keSBpcyBuZXZlciB0aW1lZAojIEFVVEhfX0dPT0dMRV9DTElFTlRfSUQ9CiMgQVVUSF9fR09PR0xFX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19QUk9WSURFUl9JRD1va3RhICAgICAgICAjIGFueSBPSURDIElkUCwgYnkgZXhwbGljaXQgZW5kcG9pbnRzIChwcmVmZXJyZWQ6IG5vdGhpbmcgZmV0Y2hlZCBhdCBib290KSBvciBkaXNjb3ZlcnkKIyBBVVRIX19PSURDX0NMSUVOVF9JRD0KIyBBVVRIX19PSURDX0NMSUVOVF9TRUNSRVQ9CiMgQVVUSF9fT0lEQ19BVVRIT1JJWkFUSU9OX1VSTD0KIyBBVVRIX19PSURDX1RPS0VOX1VSTD0KIyBBVVRIX19PSURDX1VTRVJJTkZPX1VSTD0KIyBBVVRIX19PSURDX0RJU0NPVkVSWV9VUkw9ICAgICAgICAgICMgaWYgc2V0LCBmZXRjaGVkIEFUIEJPT1Qg4oCUIGFuIHVucmVhY2hhYmxlIElkUCBmYWlscyB0aGUgYm9vdCwgbG91ZGx5CiMgQURNSU5fX1NFQ1JFVD0gICAgICAgICAgICAgICAgICAgICAjIHRoZSBvcGVyYXRpb25hbCBhZG1pbiBzZWNyZXQgKFBPU1QgL2FwaS90b2tlbnMgZXRjLikKIyBSRU1PVEUgU1FMIChNNik6IG1vdmUgdGhlIER1Y2tEQiBlbmdpbmUgb3V0IG9mIHRoaXMgcHJvY2Vzcy4gVGhlIHNlcnZpY2UgcnVucwojIHRoZSBzYW1lIG1vZHVsZSB1bmRlciB0aGUgc2FtZSBndWFyZHM7IHRoZSBTUUwsIHRoZSBwYXJhbXMgYW5kIHRoZSByb3dzIHRvCiMgcmVnaXN0ZXIgdHJhdmVsIHRvIGl0IOKAlCBuZXZlciBhIGRvY3VtZW50LCBuZXZlciBhIGNyZWRlbnRpYWwuIFVuc2V0ICh0aGUKIyBzZWxmLWhvc3QgZGVmYXVsdCkgdGhlIGVuZ2luZSBydW5zIGluLXByb2Nlc3Mgb24gdGhlIG5hdGl2ZSBtb2R1bGUuCiMgU1FMX19TRVJWSUNFX1VSTD1odHRwOi8vc3FsOjgwODAKCiMgT3JpZ2luIHRoZSBleHBvcnQgYnJvd3NlciB1c2VzIGZvciB0aGlzIGFwcDsgYmxhbmsgZGVmYXVsdHMgdG8gdGhpcyBwcm9jZXNzLgpFWFBPUlRfX0lOVEVSTkFMX09SSUdJTj0KCiMgT3B0aW9uYWwgY2xpZW50IGFuYWx5dGljczsgYmxhbmsgdG9rZW4gZGlzYWJsZXMgaXQuIEhvc3QgZGVmYXVsdHMgdG8gTWl4cGFuZWwncyBVUyBlbmRwb2ludC4KTUlYUEFORUxfX1RPS0VOPQpNSVhQQU5FTF9fSE9TVD1odHRwczovL2FwaS1qcy5taXhwYW5lbC5jb20K';
const ENV_EXAMPLE = Buffer.from(ENV_EXAMPLE_BASE64, 'base64').toString('utf8');

function httpUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return undefined;
  } catch {}
  return 'Public URL must be an absolute http(s) URL';
}

function portError(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535
    ? undefined
    : 'Port must be an integer from 1 to 65535';
}

function postgresUrlError(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname) return undefined;
  } catch {}
  return 'Database URL must be a Postgres URL';
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

function publicUrlFromPort(port) {
  const url = new URL(DEFAULT_PUBLIC_URL);
  url.port = String(port);
  return url.origin;
}

function fromAddress(publicUrl) {
  return `artifact-bin <login@${new URL(publicUrl).hostname}>`;
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
    ...answerOverrides,
  };
  if (answerOverrides.port !== undefined && answerOverrides.publicUrl === undefined) {
    answers.publicUrl = publicUrlFromPort(answerOverrides.port);
  } else if (answerOverrides.publicUrl !== undefined && answerOverrides.port === undefined) {
    answers.port = portFromPublicUrl(answerOverrides.publicUrl);
  }
  return answers;
}

export function questions() {
  return [
    { key: 'publicUrl', prompt: 'Public URL people will reach this on', default: DEFAULT_PUBLIC_URL, validate: httpUrlError },
    { key: 'port', prompt: 'Port to listen on', default: (answers) => portFromPublicUrl(answers.publicUrl), validate: portError },
    { key: 'email', prompt: 'Login mail: Resend API key (blank = no email login; anonymous tokens still work)', default: '', validate: () => undefined, secret: true },
    { key: 'emailFrom', prompt: 'From address', default: (answers) => fromAddress(answers.publicUrl), validate: (value) => String(value).trim() ? undefined : 'From address must not be blank', when: (answers) => Boolean(answers.email) },
    { key: 'database', prompt: 'Database: [1] embedded PGLite (zero config)  [2] my own Postgres URL', default: '1', validate: (value) => ['1', '2', 'pglite', 'postgres'].includes(String(value)) ? undefined : 'Database must be 1 or 2' },
    { key: 'databaseUrl', prompt: 'Postgres URL', default: '', validate: postgresUrlError, secret: true, when: (answers) => answers.database === 'postgres' || answers.database === '2' },
    { key: 'objects', prompt: 'Objects: [1] local directory  [2] S3-compatible URL', default: '1', validate: (value) => ['1', '2', 'local', 's3'].includes(String(value)) ? undefined : 'Objects must be 1 or 2' },
    { key: 's3Url', prompt: 'S3-compatible URL', default: '', validate: s3UrlError, secret: true, when: (answers) => answers.objects === 's3' || answers.objects === '2' },
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

export function buildEnvFile(answerOverrides, { generated }) {
  const answers = defaultAnswers(answerOverrides);
  validateAnswers(answers);
  for (const name of ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET']) {
    if (!generated?.[name]) throw new Error(`Missing generated ${name}`);
  }

  let text = ENV_EXAMPLE
    .replace(/^ADMIN__SECRET=.*$/m, `ADMIN__SECRET=${generated.ADMIN__SECRET}`)
    .replace(/^AUTH__SECRET=.*$/m, `AUTH__SECRET=${generated.AUTH__SECRET}\n\n# Secret for signing trusted actor headers between services.\nCONTRACT__ACTOR_SECRET=${generated.CONTRACT__ACTOR_SECRET}`)
    .replace(/^# BROWSER__SERVICE_URL=.*$/m, (line) => `${line}\n# Shared bearer secret for split app/sql/browser deployments.\nINTERNAL__SERVICE_SECRET=${generated.INTERNAL__SERVICE_SECRET}`)
    .replace(/^APP__PUBLIC_BASE_URL=.*$/m, `APP__PUBLIC_BASE_URL=${answers.publicUrl}`)
    .replace(/^APP__PORT=.*$/m, `APP__PORT=${answers.port}`);

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
