/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { Actor, Part, Queryable, Upstream } from '@artifactbin/contracts';
import type { Actor as TopicActor } from '@artifactbin/contracts/actor';
import type { Part as TopicPart, Upstream as TopicUpstream } from '@artifactbin/contracts/part';
import type { Queryable as TopicQueryable } from '@artifactbin/contracts/db';
import type { TransactionalQueryable } from '@artifactbin/contracts/identity-module';
import type { EventEnvelope, EventPayload, EventVerb, EventsService, ObjectKind } from '@artifactbin/contracts/events';
import type { MutationInput, MutationOutcome, SqlService } from '@artifactbin/contracts/sql';
import type { DatasetPolicy } from '@artifactbin/contracts/dataset-policy';
import type { TokenReader, TokenRecord } from '@artifactbin/contracts/identity';
import type {
  Connection, ConnectionConfig, ConnectionSummary, ConnectorAnswer, ConnectorColumn,
  ConnectorError, ConnectorErrorCode, ConnectorField, ConnectorId, ConnectorNetworkPolicy,
  ConnectorQuery, ConnectorSchema, ConnectorSpec, ConnectorTestResult, ConnectorValueType, ConnectorViewer,
  ConnectorFieldKind, ConnectorDialect, ConnectorScalar, ConnectorJson, ConnectorLimits, ConnectorSchemaTable,
} from '@artifactbin/contracts/connectors';

expectTypeOf<[
  Actor, TransactionalQueryable, DatasetPolicy, EventEnvelope,
  EventPayload<'artifact', 'created'>, EventVerb<'artifact'>, EventsService,
  MutationInput, MutationOutcome, ObjectKind, Part, Queryable, SqlService, TokenReader, TokenRecord, Upstream,
]>().not.toBeNever();

expectTypeOf<[TopicActor, TopicPart, TopicQueryable, TopicUpstream]>().toEqualTypeOf<[Actor, Part, Queryable, Upstream]>();

expectTypeOf<[
  Connection, ConnectionConfig, ConnectionSummary, ConnectorAnswer, ConnectorColumn,
  ConnectorError, ConnectorErrorCode, ConnectorField, ConnectorId, ConnectorNetworkPolicy,
  ConnectorQuery, ConnectorSchema, ConnectorSpec, ConnectorTestResult, ConnectorValueType, ConnectorViewer,
  ConnectorFieldKind, ConnectorDialect, ConnectorScalar, ConnectorJson, ConnectorLimits, ConnectorSchemaTable,
]>().not.toBeNever();
