/**
 * One connection string for object storage, parsed here.
 *
 * minusx spreads this across five variables (OBJECT_STORE_BUCKET / REGION /
 * ACCESS_KEY_ID / SECRET_ACCESS_KEY / ENDPOINT). Five secrets to set correctly
 * is five chances to set one wrong, and the failure is silent until an upload
 * fails. This repo already treats a connection as ONE string (`DATABASE_URL`),
 * so object storage follows suit.
 *
 * Neither client library parses a URL — `@aws-sdk/client-s3` and `minio` both
 * take discrete fields — so the parsing is ours. It is a pure function, which
 * is the reason it can be tested exhaustively rather than discovered in
 * production.
 *
 *   s3://ACCESS_KEY:SECRET@s3.amazonaws.com/my-bucket?region=eu-west-1
 *   s3://minioadmin:minioadmin@localhost:9000/artifacts?forcePathStyle=true
 *   http://KEY:SECRET@localhost:9000/bucket        (http:// = insecure endpoint)
 */
export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Absolute endpoint for S3-compatible stores; undefined means real AWS. */
  endpoint?: string;
  /** MinIO and most self-hosted stores need path-style addressing. */
  forcePathStyle: boolean;
  /**
   * Key prefix, from the path segments after the bucket. One shared bucket
   * holds several environments, so `/minusx/artifacts-dev` and
   * `/minusx/artifacts` are the same bucket with different roots — and a dev
   * machine can never write over production objects by misconfiguration.
   * Normalised without a trailing slash; '' when the URL names only a bucket.
   */
  prefix: string;
}

export class InvalidS3Url extends Error {
  constructor(message: string) {
    super(`S3_URL is invalid: ${message}`);
    this.name = 'InvalidS3Url';
  }
}

export function parseS3Url(raw: string): S3Config {
  const text = (raw ?? '').trim();
  if (!text) throw new InvalidS3Url('it is empty');

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InvalidS3Url(`"${text}" is not a URL`);
  }

  // s3:// and https:// mean a TLS endpoint; http:// is honoured as insecure,
  // because a local MinIO over plain http is the ordinary dev setup and
  // silently upgrading it produces a baffling TLS error instead.
  const scheme = url.protocol.replace(':', '').toLowerCase();
  if (!['s3', 'http', 'https'].includes(scheme)) {
    throw new InvalidS3Url(`scheme "${scheme}" is not supported (use s3://, https:// or http://)`);
  }

  // decodeURIComponent, not the raw field: generated secrets routinely contain
  // / + and =, which must be percent-encoded in a URL. Skipping the decode
  // yields a signature mismatch that says nothing about the real cause.
  const accessKeyId = decodeURIComponent(url.username || '');
  const secretAccessKey = decodeURIComponent(url.password || '');
  if (!accessKeyId || !secretAccessKey) {
    throw new InvalidS3Url('it carries no credentials (expected s3://KEY:SECRET@host/bucket)');
  }

  // First segment is the bucket; everything after it is the key prefix, which
  // is how one bucket serves several environments.
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const bucket = segments[0] ?? '';
  if (!bucket) throw new InvalidS3Url('it names no bucket (expected s3://KEY:SECRET@host/bucket)');
  const prefix = segments.slice(1).join('/');

  const endpointScheme = scheme === 'http' ? 'http' : 'https';
  return {
    bucket,
    region: url.searchParams.get('region') || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    endpoint: `${endpointScheme}://${url.host}`,
    forcePathStyle: url.searchParams.get('forcePathStyle') === 'true',
    prefix,
  };
}

/**
 * The object key an S3 store actually writes: the configured prefix joined to
 * the caller's key.
 *
 * Pure and exported ON PURPOSE. The prefix is the ONLY thing keeping a dev
 * machine from writing over production objects — one bucket serves both,
 * separated by `artifacts` vs `artifacts-dev` — and while the rule lived
 * inline in the S3 store it could only be checked against a real server, so
 * CI never checked it at all: deleting it broke no test.
 */
export function storageKeyFor(config: Pick<S3Config, 'prefix'>, key: string): string {
  return config.prefix ? `${config.prefix}/${key}` : key;
}
