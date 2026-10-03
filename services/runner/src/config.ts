import { createEnv } from '@artifactbin/utils';
/** Controller settings only. None of these credentials enter a worker environment. */
export function runnerConfig(source: Record<string, string | undefined>) {
    const env = createEnv(source);
    const image = env.env('RUNNER', 'WORKER_IMAGE');
    const baseUrl = env.env('RUNNER', 'OPENAI_BASE_URL');
    const apiKey = env.env('RUNNER', 'OPENAI_API_KEY');
    const model = env.env('RUNNER', 'MODEL');
    const concurrent = Number(env.env('RUNNER', 'MAX_CONCURRENT') ?? 4);
    const port = Number(env.env('RUNNER', 'PORT') ?? 3050);
    const dataDir = env.env('RUNNER', 'DATA_DIR') ?? './data/runner';
    const secret = env.env('CONTRACT', 'ACTOR_SECRET');
    const appUrl = env.env('RUNNER', 'ARTIFACTBIN_BASE_URL');
    return { image, port, dataDir, secret, appUrl, concurrent, ai: baseUrl && model ? { baseUrl, apiKey, models: [model], defaultModel: model } : undefined, names: env.namesRead() };
}
