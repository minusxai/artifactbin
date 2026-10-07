import { createEnv } from '@artifactbin/utils';
import type { HostCapabilitiesOptions } from './capabilities';
/** Controller settings only. None of these credentials enter a worker environment. */
export function runnerConfig(source: Record<string, string | undefined>) {
    const env = createEnv(source);
    const image = env.env('RUNNER', 'WORKER_IMAGE');
    const baseUrl = env.env('RUNNER', 'OPENAI_BASE_URL');
    const apiKey = env.env('RUNNER', 'OPENAI_API_KEY');
    const model = env.env('RUNNER', 'MODEL');
    const outputTokenField = env.env('RUNNER', 'OUTPUT_TOKEN_FIELD') ?? 'max_completion_tokens';
    if (outputTokenField !== 'max_tokens' && outputTokenField !== 'max_completion_tokens') throw Error('invalid_ai_output_token_field');
    const maxOutputTokens = Number(env.env('RUNNER', 'MAX_OUTPUT_TOKENS') ?? 8192);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw Error('invalid_ai_output_limit');
    const concurrent = Number(env.env('RUNNER', 'MAX_CONCURRENT') ?? 4);
    const port = Number(env.env('RUNNER', 'PORT') ?? 3050);
    const dataDir = env.env('RUNNER', 'DATA_DIR') ?? './data/runner';
    const secret = env.env('CONTRACT', 'ACTOR_SECRET');
    const appUrl = env.env('RUNNER', 'ARTIFACTBIN_BASE_URL');
    const ai: HostCapabilitiesOptions['ai'] = baseUrl && model ? { baseUrl, apiKey, models: [model], defaultModel: model, outputTokenField, maxOutputTokens } : undefined;
    return { image, port, dataDir, secret, appUrl, concurrent, ai, names: env.namesRead() };
}
