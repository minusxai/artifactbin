import type {DatasetAccessPolicy,DatasetPermissions,DatasetPermissionsIssue,DatasetPermissionsShape,Scalar} from '@artifactbin/contracts';
import {parseDatasetAccessPolicy,compilePolicyPredicate} from '@artifactbin/utils';
import {datasetPermissionsTemplate,validateDatasetPermissions} from '@artifactbin/utils/dataset-permissions';
import type {DatasetHost} from '@/lib/datasets/types';
import {catalogOf} from '@/lib/datasets/catalog';
import {storedConfiguration} from '@/lib/datasets/graphql-names';

/** A policy as stored: version 3, or a version 1/2 one written before the stored migration. */
export type StoredDatasetPolicy = DatasetAccessPolicy | DatasetPermissions;

/** The refusal a version 1/2 body gets from every policy-setting door. Stored ones keep working until migrated. */
export const LEGACY_POLICY_REFUSED = 'Version 1 and 2 dataset policies can no longer be set: send a version 3 policy, {"version":3,"tables":[{"table":{"schema":"public","name":"rows"},"select_permissions":[{"role":"viewer","permission":{"columns":"*","filter":{}}}]}]}, with Hasura permission entries for the roles viewer, signed_in and anonymous (owner and editors always have full access). GET the policy for the dataset\'s tables and current rules.';

type PolicyRow = Pick<DatasetHost,'format'|'meta'|'dataset_policy'>;
const tablesOf = (row:PolicyRow) => catalogOf(row)?.tables ?? [{schema:'public',name:'rows',columns:(row.meta.columns ?? []) as Array<{ name: string }>}];
const shapeOf = (row:PolicyRow):DatasetPermissionsShape => ({tables:tablesOf(row).map(t=>({table:{schema:t.schema,name:t.name},columns:t.columns.map(c=>c.name)}))});
const isV3 = (value:unknown) => !!value && typeof value==='object' && (value as {version?:unknown}).version===3;

/**
 * The new-dataset default: the read-only template over the dataset's own tables (everyone who reaches it reads;
 * only the owner and editors write). `name`, given only at creation, is the single table's GraphQL root.
 */
export function readOnlyDatasetPolicy(row:Pick<DatasetHost,'meta'>,name?:string):DatasetPermissions {
 const result=datasetPermissionsTemplate('read-only',shapeOf({...row,format:'dataset'}));
 if(!result.ok)throw new Error('read-only template');
 if(name===undefined)return result.policy;
 const [table,...rest]=result.policy.tables;
 if(!table||rest.length)throw new Error('a GraphQL name needs a single-table dataset');
 return {...result.policy,tables:[{...table,configuration:{custom_name:name}}]};
}

const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);
/**
 * THE GRAPHQL NAMES ARE SERVER-OWNED (configuration: custom_name, custom_column_names): a policy write omitting a
 * table's configuration keeps the stored one, and one sending it must send it unchanged. Every policy door runs
 * this, so a stored name never changes after creation.
 */
export function keepDatasetConfiguration(policy:DatasetPermissions,stored:unknown):{policy:DatasetPermissions;errors:DatasetPermissionsIssue[]} {
 const configuration=storedConfiguration(stored),errors:DatasetPermissionsIssue[]=[];
 const tables=policy.tables.map((t,i)=>{
  const kept=configuration(t.table);
  if(t.configuration===undefined)return kept?{...t,configuration:structuredClone(kept)}:t;
  if(!sameJson(t.configuration,kept))errors.push({path:`tables[${i}].configuration`,message:`server-owned (it names the GraphQL API): omit it or send it unchanged, ${JSON.stringify(kept??null)}`});
  return t;
 });
 return {policy:{...policy,tables},errors};
}

function requireStoredDataset(row:PolicyRow) {
 if(row.format!=='dataset'||catalogOf(row)?.kind==='postgres')throw new Error('Policies require a stored dataset');
}

/** A version 3 policy checked against the dataset's tables and columns; throws naming every problem by path. */
function validateV3(row:PolicyRow,value:unknown):DatasetPermissions {
 const result=validateDatasetPermissions(value,shapeOf(row));
 if(!result.ok)throw new Error(result.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
 return result.policy;
}

/**
 * THE POLICY-SETTING DOORS (the policy API, metadata PATCH): a version 3 policy, or null (no policy reads as the
 * read-only template). The stored GraphQL names are kept (keepDatasetConfiguration; a clear keeps them too).
 * Version 1 and 2 bodies are refused with LEGACY_POLICY_REFUSED.
 */
export function validateDatasetPolicyForRow(row:PolicyRow,value:unknown):DatasetPermissions|null {
 requireStoredDataset(row);
 if(value===null)return clearedPolicy(row);
 if(isV3(value)){
  const kept=keepDatasetConfiguration(validateV3(row,value),row.dataset_policy);
  if(kept.errors.length)throw new Error(kept.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
  return kept.policy;
 }
 throw new Error(LEGACY_POLICY_REFUSED);
}

/**
 * A clear reads as the read-only template; when the stored policy names the GraphQL API (any configuration), the
 * template is stored carrying it, so clearing never renames the API.
 */
function clearedPolicy(row:PolicyRow):DatasetPermissions|null {
 const configuration=storedConfiguration(row.dataset_policy);
 if(!tablesOf(row).some(t=>configuration(t)))return null;
 return keepDatasetConfiguration(readOnlyDatasetPolicy(row),row.dataset_policy).policy;
}

/** The STORED policy still fits this row's catalog (a replacement keeps every table and column it names): any version. */
export function validateStoredDatasetPolicy(row:PolicyRow,value:unknown):StoredDatasetPolicy|null {
 requireStoredDataset(row);
 if(value===null)return null;
 if(isV3(value))return validateV3(row,value);
 return validateLegacy(row,value);
}

function validateLegacy(row:PolicyRow,value:unknown):DatasetAccessPolicy {
  const policy = parseDatasetAccessPolicy(value);
  {
    const tables = tablesOf(row);
    for (const t of policy.tables ?? []) {
      const target = tables.find(
        (x) => x.schema === t.table.schema && x.name === t.table.name,
      );
      // NAME what is missing: this message is the `detail` of both a refused
      // policy edit and a refused replacement, and "something does not fit" is
      // not a thing anyone can act on.
      if (!target)
        throw new Error(
          `Policy table is not in this dataset: ${t.table.schema}.${t.table.name}`,
        );
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
          throw new Error(
            `Unknown permission column in ${t.table.schema}.${t.table.name}: ${p.columns.filter((c) => !columns.includes(c)).join(', ')}`,
          );
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
