import type { CreateAttachmentHTTP } from "./dataset-attachment-http-contracts.ts";
import type { AttachmentScope } from "./dataset-attachment-bridge-contracts.ts";
import { ATTACHMENT_MAX_BYTES, attachmentRead, attachmentReceipt, attachmentScope, attachmentUpload, publicAttachmentReceipt } from "./dataset-attachment-validation.ts";
import { readBoundedJSON } from "./bounded-response.ts";
export const createAttachmentHTTP: CreateAttachmentHTTP = (options) => {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || !["http:","https:"].includes(origin.protocol)) throw Error("Invalid attachment platform origin");
  function capture(scope: AttachmentScope, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const page = options.pageId(), context = options.authority();
    if (!page || !context || !attachmentScope(scope)) throw Error("Attachment unavailable");
    const current = () => {
      signal?.throwIfAborted();
      if (options.pageId() !== page || options.authority() !== context) throw Error("Attachment caller changed");
    };
    return { current, path: `/api/files/${encodeURIComponent(page)}/dataset-attachments/${encodeURIComponent(scope.backendNamespace)}/${encodeURIComponent(scope.bindingName)}` };
  }
  async function send(path: string, method: "GET"|"POST", signal?: AbortSignal, body?: Blob, headers: Record<string,string> = {}) {
    const response = await options.fetch(origin.origin + path, { method, body, headers:{...options.headers(),...headers}, signal, credentials:"omit", redirect:"error" });
    if (!response.ok) { await response.body?.cancel().catch(()=>{}); throw Error("Attachment unavailable"); }
    return response;
  }
  return {
    async availability(scope, signal) {
      const {current,path} = capture(scope,signal);
      const value = await readBoundedJSON(await send(path,"GET",signal),1024);
      current();
      if (!value || typeof value.canAttempt !== "boolean") throw Error("Invalid attachment availability");
      return {canAttempt:value.canAttempt};
    },
    async upload(request,signal) {
      if (!attachmentUpload(request)) throw Error("Invalid attachment upload");
      const {current,path}=capture(request,signal);
      const response=await send(path,"POST",signal,request.blob,{"Content-Type":request.contentType,"X-Filename":encodeURIComponent(request.filename),"Idempotency-Key":request.requestId});
      const receipt=await readBoundedJSON(response,8192); current();
      if (!attachmentReceipt(receipt) || receipt.url !== path+"/"+receipt.ref.slice(6)) throw Error("Invalid attachment receipt");
      return publicAttachmentReceipt(receipt);
    },
    async read(request,signal) {
      if (!attachmentRead(request)) throw Error("Invalid attachment read");
      const {current,path}=capture(request,signal), response=await send(path+"/"+request.ref.slice(6),"GET",signal);
      const mime=response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
      const reader=response.body?.getReader();
      if (!reader) throw Error("Empty attachment response");
      let size=0;const chunks:ArrayBuffer[]=[];
      try {
        if (!mime || !["image/png","image/jpeg","image/webp"].includes(mime)) throw Error("Invalid attachment image");
        for (;;) {
          const {done,value}=await reader.read();current();if(done)break;
          size+=value.byteLength;if(size>ATTACHMENT_MAX_BYTES)throw Error("Attachment response too large");
          chunks.push(new Uint8Array(value).buffer);
        }
        if (!size) throw Error("Empty attachment response");
        return new Blob(chunks,{type:mime});
      } finally { await reader.cancel().catch(()=>{}); }
    },
  };
};
