import { abortableMediaStore } from "./abortable-store.ts";
import { createMediaService } from "./service.ts";
import { supplementalAddress } from "./supplemental-address.ts";
import type {
  SupplementalServiceOptions,
  SupplementalService,
} from "./supplemental-contracts.ts";
/** Authorization belongs to the exact page/comment or registered person selection, not the byte digest. */
export function createSupplementalService({
  repository,
  store,
}: SupplementalServiceOptions): SupplementalService {
  return {
    async read(request) {
      const synthetic = {
        pageId: request.address.pageId,
        revision: "1",
        variant: "original" as const,
        sha256: "0".repeat(64),
      };
      const denied = () =>
        createMediaService(
          {
            async read() {
              return null;
            },
          },
          store,
        ).read({ address: synthetic, credential: "", method: request.method });
      let path: string;
      try {
        path = supplementalAddress(request.address);
      } catch {
        return denied();
      }
      request.signal?.throwIfAborted();
      const descriptor = await repository.read(
        request.address,
        request.credential,
        request.signal,
      );
      request.signal?.throwIfAborted();
      if (!descriptor) return denied();
      try {
        if (supplementalAddress(descriptor.address) !== path) return denied();
      } catch {
        return denied();
      }
      if (
        !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
        descriptor.storageKey !== descriptor.sha256 ||
        descriptor.contentType !== "image/webp" ||
        !Number.isSafeInteger(descriptor.byteLength) ||
        descriptor.byteLength < 1 ||
        descriptor.byteLength > 32 * 1024 * 1024 ||
        ![descriptor.width, descriptor.height].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= 16384,
        )
      )
        return denied();
      const address = { ...synthetic, sha256: descriptor.sha256 };
      const response = await createMediaService(
        {
          async read() {
            return {
              ...address,
              contentType: descriptor.contentType,
              filename: descriptor.filename,
              byteLength: descriptor.byteLength,
              storageKey: descriptor.storageKey,
            };
          },
        },
        abortableMediaStore(store, request.signal),
      ).read({
        address,
        credential: "",
        method: request.method,
        ...(request.range ? { range: request.range } : {}),
      });
      if (response.status === 200 || response.status === 206) {
        try {
          const fresh = await repository.read(
            request.address,
            request.credential,
            request.signal,
          );
          request.signal?.throwIfAborted();
          if (JSON.stringify(fresh) !== JSON.stringify(descriptor)) {
            await response.close();
            return denied();
          }
        } catch (error) {
          await response.close();
          throw error;
        }
      }
      return response;
    },
  };
}
