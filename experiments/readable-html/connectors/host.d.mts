import type { Binding, ConnectorHost, Json } from './contracts.ts';
export function validateJson(value: unknown, maxBytes?: number): Json;
export function createConnectorHost(bindings: Record<string, Binding>, options?: {timeoutMs?: number; maxBytes?: number; maxActive?: number}): ConnectorHost;
