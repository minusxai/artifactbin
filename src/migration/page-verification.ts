import { migrationPageDigest } from "./import.ts";
import {projectMigrationCommentState} from "./comment-state.ts";
import {legacyDocumentSource} from "./conversion/index.ts";
import { migrationCommentAssetRecords } from "./assets/comment-records.ts";
import { createHash } from "node:crypto";
import { destinationSchemas } from "./destination-schema.ts";
import { destinationAccess, publicationPath } from "./postgres.ts";
import { prepareMigrationPageSources } from "./page-source-preparation.ts";
import { projectMigrationCommentContext } from "./comment-projection.ts";
import { requireMigrationEquality as equal } from "./verification-values.ts";
import type { VerifyMigrationRuntime } from "./verification-contracts.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
/** Compare actual content and authority to source-derived expectations, not import receipts. */
export const verifyMigrationRuntime: VerifyMigrationRuntime = async (
  db,
  schema,
  input,
) => {
  const { runtime, archive } = destinationSchemas(schema);
  const totals = {
    pages: 0,
    sources: 0,
    comments: 0,
    snapshots: 0,
    assets: 0,
    backendLinks: 0,
    normalizedBytes: 0,
  };
  const ready = new Set<string>();
  for await (const page of input.pages) {
    ready.add(page.pageId);
    if (page.revisions.some(r => r.conversion.historicalUnavailable || "sourceNormalization" in r.conversion)) {
      equal(
        (await db.query(`SELECT page_id,digest FROM ${archive}.receipts WHERE page_id=$1`, [page.pageId])).rows,
        [{page_id: page.pageId, digest: migrationPageDigest(page)}],
        "historical preservation and source normalization receipt provenance",
      );
    }
    const owner = page.owner?.id;
    const normalized = prepareMigrationPageSources(page, input.origin);
    const preparedHead = normalized.find(
      (r) => r.version === page.original.version,
    )!.prepared;
    const liveComments = page.comments.filter((c) => !c.deleted_at);
    const file = (
      await db.query(
        `SELECT owner,head,path,access,deleted_at,seed,sequence::text,source_digest,next_node_id,generation,share,trash_path,trash_batch FROM ${runtime}.files WHERE id=$1`,
        [page.pageId],
      )
    ).rows;
    equal(
      file,
      [
        {
          owner,
          head: String(page.original.version),
          path: publicationPath(page),
          access: destinationAccess(page, input.maps),
          deleted_at: null,
          seed: preparedHead.state,
          sequence: String(liveComments.length),
          source_digest: normalized.find(r=>r.version===page.original.version)!.sourceRevision,
          next_node_id: Number(preparedHead.meta.nextNodeId ?? 1),
          generation: 1,
          share: null,
          trash_path: null,
          trash_batch: null,
        },
      ],
      "page owner/head/ACL",
    );
    equal(
      (
        await db.query(
          `SELECT owner,kind,published,reservation_key,ordinal FROM ${runtime}.file_ids WHERE id=$1`,
          [page.pageId],
        )
      ).rows,
      [
        {
          owner,
          kind: "page",
          published: true,
          reservation_key: null,
          ordinal: null,
        },
      ],
      "page ID ownership registry",
    );

    equal(
      (
        await db.query(
          `SELECT id FROM ${runtime}.retired_file_ids WHERE id=$1`,
          [page.pageId],
        )
      ).rows,
      [],
      "active page ID must not be retired",
    );
    const path = publicationPath(page).split("/").slice(1, -1);
    for (let i = 1; i <= path.length; i++)
      equal(
        (
          await db.query(
            `SELECT path FROM ${runtime}.folders WHERE owner=$1 AND path=$2`,
            [owner, "/" + path.slice(0, i).join("/")],
          )
        ).rows,
        [{ path: "/" + path.slice(0, i).join("/") }],
        "page parent folders",
      );
    const sources = (
      await db.query(
        `SELECT revision,content,node_ids,digest FROM ${runtime}.sources WHERE file_id=$1 ORDER BY revision::bigint`,
        [page.pageId],
      )
    ).rows;
    equal(
      sources,
      normalized
        .map((r) => ({
          revision: String(r.version),
          content: r.prepared.source,
          node_ids: r.prepared.nodeIds,
          digest: r.sourceRevision,
        }))
        .sort((a, b) => Number(a.revision) - Number(b.revision)),
      "saved HTML revisions and identities",
    );
    totals.sources += sources.length;
    totals.normalizedBytes += sources.reduce(
      (n, r) => n + Buffer.byteLength(String(r.content)),
      0,
    );
    const comments = page.comments.filter((c) => !c.deleted_at);
    let sequence = 0;
    const snapshots: Record<string, unknown>[] = [];
    const archivedStates:Record<string,unknown>[]=[];
    const expected = comments.map((c) => {
      const root = c.root_id ? comments.find((r) => r.id === c.root_id) : c;
      if (!root) throw Error("Missing expected comment root");
      const context = projectMigrationCommentContext({
        root,
        revisions: page.revisions,
      });
      const original=page.revisions.find(r=>String(r.version)===context.sourceRevision)?.original;
      const legacySource=original?(typeof original.source==='string'&&original.source.trim()?original.source:legacyDocumentSource(original.document)):null;
      const replay=c.view_state==null?null:projectMigrationCommentState({raw:c.view_state,sourceRevision:context.sourceRevision,legacySource,initialState:normalized.find(r=>String(r.version)===context.sourceRevision)?.prepared.state??null});
      const snapshot=replay?.snapshot?'legacy-'+String(c.id):null;
      if(replay)archivedStates.push({comment_id:String(c.id),original_revision:String(root.anchor_version??'unknown'),raw:replay.raw,replay:replay.status});
      if(snapshot&&replay?.snapshot)snapshots.push({id:snapshot,source_revision:context.sourceRevision,schema_version:replay.snapshot.schema,state:replay.snapshot.state,view:replay.snapshot.view,rendered:null});
      return {
        id: String(c.id),
        node_id: context.nodeId,
        quote: String(c.quote ?? c.snippet ?? ""),
        body: String(c.body ?? ""),
        source_revision: context.sourceRevision,
        parent_id: c.root_id ?? null,
        app_state_id: snapshot,
        published_by:
          input.maps.users[String(c.author_user_id)] ??
          input.maps.tokens[String(c.author_token_id)],
        created_at: String(c.created_at),
        revision: Number(c.revision ?? 1),
        resolved: root.status === "resolved",
        fingerprint: digest(JSON.stringify(c)),
        sequence: String(++sequence),
        context_status: context.contextStatus,
        state_replay:replay?.status??null,
        changed: null,
      };
    });
    const actualComments = (
      await db.query(
        `SELECT id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence::text,context_status,state_replay,changed::text FROM ${runtime}.comments WHERE file_id=$1 ORDER BY sequence`,
        [page.pageId],
      )
    ).rows;
    equal(
      actualComments,
      expected,
      "comment body/thread/author/source context",
    );
    totals.comments += expected.length;
    const actualSnapshots = (
      await db.query(
        `SELECT id,source_revision,schema_version,state,view,rendered FROM ${runtime}.snapshots WHERE file_id=$1 ORDER BY id`,
        [page.pageId],
      )
    ).rows;
    equal(
      actualSnapshots,
      snapshots.sort((a, b) => String(a.id).localeCompare(String(b.id))),
      "comment snapshots",
    );
    totals.snapshots += snapshots.length;
    equal((await db.query(`SELECT comment_id,original_revision,raw,replay FROM ${archive}.comment_states WHERE page_id=$1 ORDER BY comment_id`,[page.pageId])).rows,archivedStates.sort((a,b)=>String(a.comment_id).localeCompare(String(b.comment_id))),"original comment state archive and explicit replay status");
    const assets = (
      await db.query(
        `SELECT revision,variant,sha256,content_type,filename,byte_length::text,storage_key FROM ${runtime}.page_assets WHERE page_id=$1 ORDER BY revision,variant`,
        [page.pageId],
      )
    ).rows;
    equal(
      assets,
      (page.assets ?? [])
        .map((a) => ({
          revision: a.revision,
          variant: a.variant,
          sha256: a.sha256,
          content_type: a.contentType,
          filename: a.filename,
          byte_length: String(a.bytes),
          storage_key: a.sha256,
        }))
        .sort(
          (a, b) =>
            a.revision.localeCompare(b.revision) ||
            a.variant.localeCompare(b.variant),
        ),
      "asset descriptors",
    );
    totals.assets += assets.length;
    const attachmentRows = (
      await db.query(
        `SELECT comment_id,attachment_id,variant,name,sha256,byte_length::text,width,height,content_type,storage_key FROM ${runtime}.comment_attachment_assets WHERE page_id=$1 ORDER BY comment_id,attachment_id,variant`,
        [page.pageId],
      )
    ).rows;
    equal(
      attachmentRows,
      migrationCommentAssetRecords(page.commentAssets ?? []),
      "comment attachment descriptors",
    );
    totals.assets += attachmentRows.length;
    const expectedLinks = (page.backends ?? [])
      .filter((b) => b.linked)
      .map((b) => ({
        page_version: b.pageVersion,
        position: 0,
        name: b.backendNamespace,
        file_id: b.backendId,
        version: b.deployment.version,
      }))
      .sort((a, b) => a.page_version - b.page_version);
    equal(
      (
        await db.query(
          `SELECT page_version,position,name,file_id,version FROM ${runtime}.af_page_backends WHERE page_id=$1 ORDER BY page_version,position`,
          [page.pageId],
        )
      ).rows,
      expectedLinks,
      "compiled backend links",
    );
    totals.backendLinks += expectedLinks.length;
    equal(
      (
        await db.query(
          `SELECT backend_id,backend_version,page_version::text,source_namespace FROM ${runtime}.dataset_member_bindings WHERE page_id=$1 ORDER BY page_version,backend_id,backend_version`,
          [page.pageId],
        )
      ).rows,
      (page.backends ?? [])
        .filter((b) => b.members)
        .map((b) => ({
          backend_id: b.backendId,
          backend_version: b.deployment.version,
          page_version: String(b.pageVersion),
          source_namespace: b.members!.sourceNamespace,
        }))
        .sort(
          (a, b) =>
            Number(a.page_version) - Number(b.page_version) ||
            a.backend_id.localeCompare(b.backend_id) ||
            a.backend_version.localeCompare(b.backend_version),
        ),
      "member backend registry",
    );

    equal(
      (
        await db.query(
          `SELECT backend_id,backend_version,page_version::text,source_namespace FROM ${runtime}.dataset_viewer_bindings WHERE page_id=$1 ORDER BY page_version,backend_id,backend_version`,
          [page.pageId],
        )
      ).rows,
      (page.backends ?? [])
        .filter((b) => b.viewer)
        .map((b) => ({
          backend_id: b.backendId,
          backend_version: b.deployment.version,
          page_version: String(b.pageVersion),
          source_namespace: b.viewer!.sourceNamespace,
        }))
        .sort(
          (a, b) =>
            Number(a.page_version) - Number(b.page_version) ||
            a.backend_id.localeCompare(b.backend_id) ||
            a.backend_version.localeCompare(b.backend_version),
        ),
      "viewer backend registry",
    );

    equal(
      (
        await db.query(
          `SELECT page_version FROM ${runtime}.af_backend_pages WHERE page_id=$1`,
          [page.pageId],
        )
      ).rows,
      page.backends?.length
        ? [
            {
              page_version: Math.max(
                ...page.backends.map((b) => b.pageVersion),
              ),
            },
          ]
        : [],
      "current backend page pointer",
    );
    for (const id of new Set(
      (page.backends ?? []).filter((b) => b.linked).map((b) => b.backendId),
    )) {
      equal(
        (
          await db.query(
            `SELECT version FROM ${runtime}.af_backend_versions WHERE file_id=$1 ORDER BY version`,
            [id],
          )
        ).rows,
        [
          ...new Set(
            page
              .backends!.filter((b) => b.linked && b.backendId === id)
              .map((b) => b.deployment.version),
          ),
        ]
          .sort()
          .map((version) => ({ version })),
        "backend version inventory",
      );
    }

    for (const b of page.backends ?? []) {
      if (!b.linked) continue;
      equal(
        (
          await db.query(
            `SELECT owner,head_version FROM ${runtime}.af_backend_files WHERE file_id=$1`,
            [b.backendId],
          )
        ).rows,
        [{ owner, head_version: b.deployment.version }],
        "backend owner/version",
      );
      equal(
        (
          await db.query(
            `SELECT page_id,type_defs,deployment FROM ${runtime}.af_backend_versions WHERE file_id=$1 AND version=$2`,
            [b.backendId, b.deployment.version],
          )
        ).rows,
        [
          {
            page_id: page.pageId,
            type_defs: b.deployment.typeDefs,
            deployment: b.deployment,
          },
        ],
        "compiled backend content",
      );
    }
    totals.pages++;
  }
  const allocated = Object.values(input.maps.pages);
  for (let offset = 0; offset < allocated.length; offset += 100) {
    const ids = allocated.slice(offset, offset + 100);
    const actual = (
      await db.query(
        `SELECT id FROM ${runtime}.files WHERE id=ANY($1::text[]) ORDER BY id`,
        [ids],
      )
    ).rows.map((r) => r.id);
    equal(
      actual,
      ids.filter((id) => ready.has(id)).sort(),
      "admitted/blocked page inventory",
    );
  }
  return totals;
};
