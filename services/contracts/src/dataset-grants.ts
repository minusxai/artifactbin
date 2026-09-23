import type { DatasetOperation, DatasetTablePolicy, DatasetPolicy } from './dataset-policy';

export type DatasetAction = 'read' | DatasetOperation;

/** Fields are conjunctive. IDs are stable identities, never handles or titles. */
export interface DatasetGrantSelector {
  user?: string;
  artifact?: string;
  artifactOwner?: string;
}

export interface DatasetGrant {
  actions: DatasetAction[];
  from: DatasetGrantSelector;
}

/** Omitted tables allow all granted writes; an explicit empty list allows none. */
export interface DatasetGrantPolicy {
  version: 2;
  allow: DatasetGrant[];
  tables?: DatasetTablePolicy[];
  execution?: DatasetPolicy['execution'];
}

export interface DatasetPrincipal {
  userId: string | null;
  tokenId: string | null;
}

/** Constructed by the server; the saved artefact context is never request input. */
export interface DatasetGrantContext {
  caller: DatasetPrincipal;
  owner: DatasetPrincipal;
  artifact?: { id: string; owner: DatasetPrincipal };
}

export type DatasetAccessPolicy = DatasetPolicy | DatasetGrantPolicy;
