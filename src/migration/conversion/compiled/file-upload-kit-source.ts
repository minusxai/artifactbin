import { nativeUploadAdvisory } from "./file-upload-advisory.ts";
import { createHash } from "node:crypto";
/** The native control owns selection/retry UI; only transport and authority are replaced. */
export function archivedFileUploadControlSource(source: string): string {
  if (
    createHash("sha256").update(source).digest("hex") !==
    "9b5bad9083ca659633df77611e07bb36a014c76c37d9ebc27dbb2b1c891a17d0"
  )
    throw Error("Unsupported archived upload control");
  return source
    .replace(
      "import { DEFAULT_UPLOAD_MAX_BYTES, type DatasetUploadResult } from '@artifactbin/contracts';",
      "const DEFAULT_UPLOAD_MAX_BYTES=50_000_000; type DatasetUploadResult={ref:string;name:string;contentType:string;size:number};",
    )
    .replace(
      "import { bindPage } from '@/lib/page-store/page-bindings';",
      `const nativeUploadAdvisory=(${nativeUploadAdvisory.toString()});`,
    )
    .replace(
      "const binding = () => bindPage(island.store());",
      `const binding = () => ({upload:(dataset:string,file:File)=>(island.store() as any).uploadAttachment(name(),dataset,file),fileUrl:(dataset:string,ref:string)=>(island.store() as any).attachmentFileUrl(name(),dataset,ref),fileMetadata:(dataset:string,ref:string)=>(island.store() as any).attachmentFileMetadata?.(name(),dataset,ref)});`,
    )
    .replaceAll("metadata()[ref]", "displayMetadata(ref)")
    .replace(
      "const filename = (ref: string) => displayMetadata(ref)?.name ?? ref;",
      `const displayMetadata = (ref: string) => metadata()[ref] ?? binding().fileMetadata(text(p.dataset),ref);\n  const filename = (ref: string) => displayMetadata(ref)?.name || 'Uploaded image';`,
    )
    .replace(
      "(!island.viewer() ? 'Sign in to upload files.' : '')",
      "nativeUploadAdvisory(island.store(),name())",
    )
    .replace(
      "expected = value; generation++; setFailures([]);",
      "expected = value; generation++; (island.store() as any)?.releaseAttachment?.(name()); setFailures([]);",
    )
    .replace(
      "onCleanup(() => { disposed = true; generation++;",
      "onCleanup(() => { disposed = true; generation++; (island.store() as any)?.releaseAttachment?.(name());",
    )
    .replace(
      "const remove = (ref: string) => { generation++;",
      "const remove = (ref: string) => { generation++; (island.store() as any)?.releaseAttachment?.(name());",
    );
}
