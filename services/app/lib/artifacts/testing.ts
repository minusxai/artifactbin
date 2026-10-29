/**
 * lib/artifacts' TEST ENTRY: the store's names only tests use — the quota overrides (configuration freezes at
 * import), the after-commit listeners, the header column list, the account listing, the asset byte count and the
 * one-off registered-head repairs. Only test files and the test harness may import it (`testOnly` in
 * DEEP_MODULES['lib/artifacts'], scripts/ci/module-graph.mjs); product code uses the index.
 */
export { ARTIFACT_HEADER_COLUMNS } from './rows';
export { listArtifactsFor, setArtifactQuotaForTests } from './store';
export { assetBytesForToken, setAssetByteQuotaForTests } from './asset-quota';
export { onDatasetCommitted, onHeadCommitted } from './after-commit';
export { repairRegisteredMutationHead, repairRegisteredQueryHead } from './registered-repair';
