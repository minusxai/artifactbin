/** Browser-gate upstream fixture, installed before the app cache is created. */
const upstreamFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === 'https://api.github.com/repos/minusxai/artifactbin') {
    return new Response(JSON.stringify({ full_name: 'minusxai/artifactbin', stargazers_count: 1234 }), { headers: { 'content-type': 'application/json' } });
  }
  return upstreamFetch(input, init);
};
