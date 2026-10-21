/** Deployment configuration is trusted; browser request headers are not. */
export interface HostedConfig {
  platformOrigin?: string;
  /** HTTPS origin template with a single {document} hostname label. */
  runnerOrigin?: string;
}
export interface HostedBoot {
  home: string;
  fileId: string;
  runner: string;
  sourceUrl: string;
  stateUrl: string;
}
export type HostedRequest =
  | { kind: "platform"; origin: string }
  | { kind: "runner"; origin: string; document: string };
