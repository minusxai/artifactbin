import { createDatasetMutationEngine } from "../engine.ts";
import { validateDatasetSqlJob } from "../job.ts";
import { DATASET_SQL_LIMITS as limits } from "../../mutation/contracts.ts";
let total = 0;
const chunks = [];
try {
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > limits.inputBytes) throw Error("input_limit");
    chunks.push(chunk);
  }
  const job = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  validateDatasetSqlJob(job);
  const engine = await createDatasetMutationEngine();
  const result = engine.mutate(job.input);
  const bytes = JSON.stringify(result);
  if (Buffer.byteLength(bytes) > limits.outputBytes)
    throw Error("output_limit");
  process.stdout.write(bytes);
} catch {
  process.exitCode = 1;
}
