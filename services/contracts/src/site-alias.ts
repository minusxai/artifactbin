/** A folder alias shares one DNS label with its owner's encoded handle. */
export function siteAliasLimit(ownerHost: string): number {
  const owner = ownerHost.split('.')[0]!;
  return Math.min(63 - owner.length - 2, 253 - ownerHost.length - 2);
}

export function validSiteAlias(label: string, ownerHost: string): boolean {
  return label.length <= siteAliasLimit(ownerHost) && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}
