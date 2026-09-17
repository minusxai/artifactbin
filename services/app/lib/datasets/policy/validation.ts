import type {DatasetPolicy,Scalar} from '@artifactbin/contracts';
import {parseDatasetPolicy,compilePolicyPredicate} from '@artifactbin/utils';
import type {ArtifactRow} from '@/lib/artifacts';
import {catalogOf} from '@/lib/datasets/catalog';

/** Validate governance against the exact row held by the write transaction. */
export function validateDatasetPolicyForRow(row:Pick<ArtifactRow,'format'|'meta'>,value:unknown):DatasetPolicy|null {
 if(row.format!=='dataset'||catalogOf(row)?.kind==='postgres')throw new Error('Policies require a stored dataset');
  const policy = value === null ? null : parseDatasetPolicy(value);
  if (policy) {
    const tables = catalogOf(row)?.tables ?? [
      {
        schema: 'public',
        name: 'rows',
        columns: (row.meta.columns ?? []) as Array<{ name: string }>,
      },
    ];
    for (const t of policy.tables) {
      const target = tables.find(
        (x) => x.schema === t.table.schema && x.name === t.table.name,
      );
      if (!target) throw new Error('Policy table is not in this dataset');
      const columns = target.columns.map((c) => c.name);
      for (const entry of [
        ...(t.insert_permissions ?? []),
        ...(t.update_permissions ?? []),
        ...(t.delete_permissions ?? []),
      ]) {
        if (entry.role !== 'viewer')
          throw new Error(
            'Data policies use the viewer role for everyone with dataset access',
          );
        const p = entry.permission;
        if (
          'columns' in p &&
          p.columns !== undefined &&
          p.columns !== '*' &&
          p.columns.some((c) => !columns.includes(c))
        )
          throw new Error('Unknown permission column');
        for (const field of ['filter', 'check'] as const)
          if (field in p && p[field as keyof typeof p]) {
            // Validate field names now; trusted session values are available only at execution.
            const session: Record<string, Scalar> = {
              'x-hasura-user-id': 'validation',
              'x-hasura-role': entry.role,
            };
            compilePolicyPredicate(
              (
                p as {
                  filter?: Record<string, unknown>;
                  check?: Record<string, unknown>;
                }
              )[field]!,
              columns,
              session,
            );
          }
        if (
          'set' in p &&
          p.set &&
          Object.keys(p.set).some((c) => !columns.includes(c))
        )
          throw new Error('Unknown preset column');
      }
    }
  }
 return policy;
}
