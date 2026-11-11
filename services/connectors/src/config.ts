/**
 * A CONNECTION'S CONFIGURATION, checked against its connector's declared fields (contracts `CONNECTORS`): the
 * connector exists, every field is declared and of its kind, every required one is present, defaults filled in. A
 * refusal names the field, never its value. `connectionSummary` is what a person may see (the `shown` fields, picked
 * by name, so a field added later is hidden until it says otherwise); `connectionSecrets` is what every error text has
 * removed.
 */
import { CONNECTORS, type ConnectionConfig, type ConnectionSummary, type ConnectorScalar, type ConnectorSpec } from '@artifactbin/contracts';
import { ConnectorFailure } from './errors';

export const connectorSpec = (id: unknown): ConnectorSpec | undefined => CONNECTORS.find((c) => c.id === id);

const invalid = (message: string) => new ConnectorFailure('invalid_config', message);

/** Parses a configuration (JSON text or an object). Throws `invalid_config`; a JSON syntax error never echoes the text. */
export function parseConnectionConfig(input: unknown): ConnectionConfig {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch { throw invalid('the configuration is not JSON'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('the configuration is one JSON object, {"connector": …}');
  const raw = value as Record<string, unknown>;
  const spec = connectorSpec(raw.connector);
  if (!spec) throw invalid(`connector must be one of ${CONNECTORS.map((c) => c.id).join(', ')}`);
  for (const key of Object.keys(raw)) if (key !== 'connector' && !spec.fields.some((f) => f.name === key)) throw invalid(`${spec.id} has no field ${JSON.stringify(key.slice(0, 64))}`);
  const out: Record<string, ConnectorScalar> = { connector: spec.id };
  for (const field of spec.fields) {
    let v = raw[field.name];
    if (v === undefined || v === null || v === '') {
      if (field.required) throw invalid(`${spec.id} needs ${field.name}`);
      if (field.default !== undefined) out[field.name] = field.default;
      continue;
    }
    if (field.kind === 'json' && typeof v === 'object') v = JSON.stringify(v);
    if (field.kind === 'integer') {
      if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 65535) throw invalid(`${spec.id}.${field.name} must be a whole number from 1 to 65535`);
    } else if (typeof v !== 'string') throw invalid(`${spec.id}.${field.name} must be text`);
    else if (field.kind === 'string' && (v.length > 1024 || /[\0\r\n]/.test(v))) throw invalid(`${spec.id}.${field.name} must be one line of at most 1024 characters`);
    else if (field.kind === 'choice' && !field.choices!.includes(v)) throw invalid(`${spec.id}.${field.name} must be one of ${field.choices!.join(', ')}`);
    else if (field.kind === 'pem' && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(v.trim())) throw invalid(`${spec.id}.${field.name} must be PEM certificates`);
    else if (field.kind === 'json') { try { JSON.parse(v); } catch { throw invalid(`${spec.id}.${field.name} must be a JSON document`); } }
    out[field.name] = v;
  }
  return out as ConnectionConfig;
}

export function connectionSummary(config: ConnectionConfig): ConnectionSummary {
  const spec = connectorSpec(config.connector)!;
  const fields: Record<string, string | number> = {};
  for (const field of spec.fields) {
    const v = config[field.name];
    if (field.shown && !field.secret && (typeof v === 'string' || typeof v === 'number')) fields[field.name] = v;
  }
  return { connector: spec.id, label: spec.label, fields };
}

/** Every secret value of the configuration, and the parts of a JSON secret (a key's private key, say). */
export function connectionSecrets(config: ConnectionConfig): string[] {
  const spec = connectorSpec(config.connector)!, out: string[] = [];
  for (const field of spec.fields) {
    const v = config[field.name];
    if (!field.secret || typeof v !== 'string' || !v) continue;
    out.push(v);
    if (field.kind === 'json') {
      try { for (const part of Object.values(JSON.parse(v) as Record<string, unknown>)) if (typeof part === 'string' && part.length >= 16) out.push(part); } catch { /* checked at parse */ }
    }
  }
  return out;
}
