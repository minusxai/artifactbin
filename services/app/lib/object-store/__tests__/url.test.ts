/**
 * Parsing one S3 connection string.
 *
 * This is the only place a misconfiguration can hide, and the failure mode is
 * nasty: a subtly wrong endpoint or bucket does not throw at boot, it throws on
 * the first upload, in production, for a user. So the edge cases are enumerated
 * here rather than discovered there.
 *
 * Credentials appear in these fixtures; they are fictional.
 */
import { describe, it, expect } from 'vitest';
import { parseS3Url, InvalidS3Url } from '../url';

describe('the common shapes', () => {
  it('parses real AWS with an explicit region', () => {
    expect(parseS3Url('s3://AKIA123:sekret@s3.amazonaws.com/my-bucket?region=eu-west-1')).toEqual({
      bucket: 'my-bucket',
      region: 'eu-west-1',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'sekret',
      endpoint: 'https://s3.amazonaws.com',
      forcePathStyle: false,
      prefix: '',
    });
  });

  it('parses a self-hosted store with a port, defaulting to path-style', () => {
    const c = parseS3Url('s3://minioadmin:minioadmin@localhost:9000/artifacts?forcePathStyle=true');
    expect(c.endpoint).toBe('https://localhost:9000');
    expect(c.bucket).toBe('artifacts');
    expect(c.forcePathStyle).toBe(true);
  });

  it('treats an http:// scheme as an INSECURE endpoint, not an error', () => {
    // Local MinIO over plain http is the ordinary dev setup; silently upgrading
    // it to https would fail to connect with a confusing TLS error.
    expect(parseS3Url('http://key:secret@localhost:9000/bucket').endpoint).toBe('http://localhost:9000');
  });

  it('defaults the region when none is given', () => {
    expect(parseS3Url('s3://k:s@s3.amazonaws.com/b').region).toBe('us-east-1');
  });
});

describe('credentials', () => {
  it('URL-decodes a secret containing reserved characters', () => {
    // Generated secrets routinely contain / and +, which MUST be percent-encoded
    // in the URL. Failing to decode yields a signature mismatch on every call —
    // an error that says nothing about the real cause.
    const c = parseS3Url('s3://AKIA:a%2Fb%2Bc%3Dd@s3.amazonaws.com/bucket');
    expect(c.secretAccessKey).toBe('a/b+c=d');
  });

  it('URL-decodes the access key too', () => {
    expect(parseS3Url('s3://a%2Bb:secret@s3.amazonaws.com/bucket').accessKeyId).toBe('a+b');
  });

  it('rejects a URL with no credentials rather than silently using ambient ones', () => {
    // Falling back to the machine's AWS profile would work on a laptop and fail
    // in the container — the worst kind of environment-dependent bug.
    expect(() => parseS3Url('s3://s3.amazonaws.com/bucket')).toThrow(InvalidS3Url);
  });

  it('rejects a username with no password', () => {
    expect(() => parseS3Url('s3://onlykey@s3.amazonaws.com/bucket')).toThrow(InvalidS3Url);
  });
});

describe('the bucket', () => {
  it('takes the first path segment and ignores a trailing slash', () => {
    expect(parseS3Url('s3://k:s@host/bucket/').bucket).toBe('bucket');
  });

  it('rejects a URL with no bucket', () => {
    expect(() => parseS3Url('s3://k:s@s3.amazonaws.com')).toThrow(InvalidS3Url);
    expect(() => parseS3Url('s3://k:s@s3.amazonaws.com/')).toThrow(InvalidS3Url);
  });

  it('reads path segments after the bucket as a KEY PREFIX', () => {
    // One bucket serves several environments: /minusx/artifacts-dev and
    // /minusx/artifacts are the same bucket with different roots, so a dev
    // machine cannot overwrite production objects by misconfiguration.
    const c = parseS3Url('s3://k:s@host/minusx/artifacts-dev');
    expect(c.bucket).toBe('minusx');
    expect(c.prefix).toBe('artifacts-dev');
  });

  it('supports a nested prefix and strips a trailing slash', () => {
    expect(parseS3Url('s3://k:s@host/bucket/a/b/').prefix).toBe('a/b');
    expect(parseS3Url('s3://k:s@host/bucket').prefix).toBe('');
  });
});

describe('malformed input fails loudly', () => {
  it('rejects empty and non-URL strings', () => {
    for (const bad of ['', '   ', 'not a url', 'bucket-only']) {
      expect(() => parseS3Url(bad)).toThrow(InvalidS3Url);
    }
  });

  it('rejects an unsupported scheme', () => {
    expect(() => parseS3Url('ftp://k:s@host/bucket')).toThrow(InvalidS3Url);
  });

  it('names S3_URL in the message, so the fix is obvious', () => {
    expect(() => parseS3Url('nonsense')).toThrow(/S3_URL/);
  });
});

describe('forcePathStyle', () => {
  it('is false by default and only true when asked', () => {
    expect(parseS3Url('s3://k:s@s3.amazonaws.com/b').forcePathStyle).toBe(false);
    expect(parseS3Url('s3://k:s@h/b?forcePathStyle=true').forcePathStyle).toBe(true);
    expect(parseS3Url('s3://k:s@h/b?forcePathStyle=false').forcePathStyle).toBe(false);
  });
});
