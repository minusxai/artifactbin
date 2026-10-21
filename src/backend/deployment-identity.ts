/** Docker ownership and bridge identifiers for one independent deployment. */
export interface DeploymentIdentity {
  namespace: string;
  labelKey: string;
  label: string;
  filter: string;
  namePrefix: string;
  name: RegExp;
  network: string;
  bridge: string;
}
/** Bounded lowercase identity keeps Docker labels and Linux's 15-byte bridge limit safe. */
export function deploymentIdentity(namespace = "pagegi"): DeploymentIdentity {
  if (!/^[a-z][a-z0-9]{0,11}$/.test(namespace))
    throw Error("Invalid deployment namespace");
  const labelKey = `${namespace}.backend`;
  const namePrefix = `${namespace}-backend-`;
  return {
    namespace,
    labelKey,
    label: `${labelKey}=1`,
    filter: `label=${labelKey}=1`,
    namePrefix,
    name: new RegExp(
      `^${namePrefix}[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`,
    ),
    network: `${namespace}-sandbox`,
    bridge: namespace === "pagegi" ? "pagegi-sbx" : `${namespace}-sb`,
  };
}
