/** Upload policy is browser guidance; the injected adapter enforces authorization and byte validation. */
export interface AfUploadFile { ref: string; name: string; contentType?: string; size?: number }
interface AfUploadContext { dataset: string; signal: AbortSignal }
export interface AfFileUploadAdapter {
  upload(file: File, context: AfUploadContext): Promise<AfUploadFile>;
  fileUrl?(file: AfUploadFile, dataset: string): string;
}
export interface AfFileUploadChangeDetail { value: AfUploadFile[]; reason: 'upload' | 'remove' }
export interface AfUploadPolicy { multiple: boolean; accept: string; maxFiles: number; maxBytes: number }
export function uploadError(files: readonly File[], selected: number, policy: AfUploadPolicy): string {
  const limit = policy.multiple ? Math.max(1, Math.floor(policy.maxFiles)) : 1;
  if (files.length + (policy.multiple ? selected : 0) > limit) return `Choose at most ${limit} file${limit === 1 ? '' : 's'}.`;
  const rules = policy.accept.toLowerCase().split(',').map(rule => rule.trim()).filter(Boolean);
  for (const file of files) {
    if (file.size > policy.maxBytes) return `${file.name} exceeds the ${policy.maxBytes / 1_000_000} MB limit.`;
    if (rules.length && !rules.some(rule => rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : rule.endsWith('/*') ? file.type.toLowerCase().startsWith(rule.slice(0, -1)) : file.type.toLowerCase() === rule)) return `${file.name} is not an accepted file type.`;
  }
  return '';
}
/** Copy only recognized metadata; transport responses and runtime author values are untrusted. */
export function uploadFile(value: unknown): AfUploadFile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.ref !== 'string' || !item.ref.trim() || typeof item.name !== 'string' || !item.name.trim()) return null;
  return { ref: item.ref, name: item.name, ...(typeof item.contentType === 'string' ? { contentType: item.contentType } : {}), ...(typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? { size: item.size } : {}) };
}
export function uploadUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
