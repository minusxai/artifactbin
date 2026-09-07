/** The editor needs a message peer and viewport geometry, not iframe DOM access. */
export interface DocumentPeer {
  readonly contentWindow: Window | null;
  readonly origin?: string;
  getBoundingClientRect(): DOMRect;
}
export function isDocumentPeerEvent(peer: DocumentPeer | null, event: Pick<MessageEvent,'source'|'origin'>): boolean {
  return !!peer?.contentWindow && event.source === peer.contentWindow && (!peer.origin || event.origin === peer.origin);
}
