import { validCompiledPersonBindings } from "./person-binding.ts";
import type {
  CompiledPersonBinding,
  CompiledPersonCard,
  CompiledPersonPorts,
} from "./person-contracts.ts";

function card(value: unknown): CompiledPersonCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "handle,image,name" ||
    typeof v.name !== "string" ||
    !v.name ||
    v.name.length > 512 ||
    !(
      v.handle === null ||
      (typeof v.handle === "string" && v.handle.length <= 256)
    ) ||
    !(
      v.image === null ||
      (typeof v.image === "string" &&
        /^\/af\/v1\/ids\/[A-Za-z0-9]{6}\/person-images\/[A-Za-z_][A-Za-z0-9_]{0,127}\/[a-f0-9]{64}$/.test(
          v.image,
        ))
    )
  )
    return null;
  return {
    name: v.name,
    handle: v.handle as string | null,
    image: v.image as string | null,
  };
}
/** Selected identities only; source policy, membership and profile lookup remain server-owned. */
export function createCompiledPeople(
  bindings: readonly CompiledPersonBinding[],
  ports: CompiledPersonPorts,
) {
  if (!validCompiledPersonBindings(bindings))
    throw Error("Unsupported person bindings");
  type Slot = {
    id: string;
    current: boolean;
    stop: () => void;
    card: CompiledPersonCard | null;
    identity: string | null;
    imageGeneration: number;
    abort?: AbortController;
    url?: string;
    bytes: number;
  };
  const slots = new Map<string, Slot>();
  let disposed = false,
    imageBytes = 0;
  const objectUrls = ports.objectUrls ?? {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => URL.revokeObjectURL(url),
  };
  const clearImage = (slot: Slot) => {
    slot.imageGeneration++;
    slot.abort?.abort();
    slot.abort = undefined;
    if (slot.url) {
      objectUrls.revoke(slot.url);
      imageBytes -= slot.bytes;
      slot.url = undefined;
      slot.bytes = 0;
    }
  };
  const publish = () => {
    const cards: Record<string, CompiledPersonCard> = {};
    const conflicts = new Set<string>(),
      identities = new Map<string, string>();
    for (const slot of slots.values()) {
      if (!slot.card || conflicts.has(slot.id)) continue;
      if (
        Object.hasOwn(cards, slot.id) &&
        identities.get(slot.id) !== slot.identity
      ) {
        delete cards[slot.id];
        conflicts.add(slot.id);
      } else {
        identities.set(slot.id, slot.identity!);
        Object.defineProperty(cards, slot.id, {
          value: { ...slot.card },
          enumerable: true,
          configurable: true,
        });
      }
    }
    ports.changed(cards);
  };
  return {
    update(values: Readonly<Record<string, unknown>>) {
      if (disposed) return;
      let removed = false;
      for (const binding of bindings) {
        const value = Object.hasOwn(values, binding.valueName)
          ? values[binding.valueName]
          : null;
        const id =
          typeof value === "string" && value.length > 0 && value.length <= 256
            ? value
            : null;
        const old = slots.get(binding.valueName);
        if (old?.id === id && old.current) continue;
        if (old) {
          old.current = false;
          clearImage(old);
          old.stop();
          slots.delete(binding.valueName);
          removed = true;
        }
        if (!id) continue;
        const slot: Slot = {
          id,
          current: true,
          stop: () => {},
          card: null,
          identity: null,
          imageGeneration: 0,
          bytes: 0,
        };
        slots.set(binding.valueName, slot);
        const receive = (value: unknown) => {
          if (disposed || !slot.current) return;
          clearImage(slot);
          const selected = card(value);
          slot.identity = selected ? JSON.stringify(selected) : null;
          slot.card = selected ? { ...selected, image: null } : null;
          publish();
          if (selected?.image && ports.image) {
            const generation = slot.imageGeneration,
              abort = new AbortController();
            slot.abort = abort;
            void Promise.resolve()
              .then(() => ports.image!(selected.image!, abort.signal))
              .then((blob) => {
                if (
                  disposed ||
                  !slot.current ||
                  generation !== slot.imageGeneration ||
                  abort.signal.aborted
                )
                  return;
                if (
                  !(blob instanceof Blob) ||
                  blob.type !== "image/webp" ||
                  blob.size < 1 ||
                  blob.size > 4 * 1024 * 1024 ||
                  imageBytes + blob.size > 8 * 1024 * 1024
                )
                  return;
                const url = objectUrls.create(blob);
                if (typeof url !== "string" || !url.startsWith("blob:")) {
                  if (typeof url === "string") objectUrls.revoke(url);
                  return;
                }
                slot.url = url;
                slot.bytes = blob.size;
                imageBytes += blob.size;
                slot.card = { ...selected, image: url };
                publish();
              })
              .catch(() => {});
          }
        };
        const fail = () => {
          if (disposed || !slot.current) return;
          receive(null);
        };
        try {
          slot.stop = ports.watch(binding, id, receive, fail);
          if (!slot.current) slot.stop();
        } catch {
          fail();
        }
      }
      if (removed) publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots.values()) {
        slot.current = false;
        clearImage(slot);
        slot.stop();
      }
      slots.clear();
      publish();
    },
  };
}
