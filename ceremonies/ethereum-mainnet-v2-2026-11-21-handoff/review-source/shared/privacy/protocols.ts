/** Protocol IDs are independent of the encrypted backup envelope's version. */
import { PROTOCOL_VERSION } from "./constants";

export const V2_PROTOCOL = "hylsia-pp-v2-candidate" as const;
/** Production-target identity. Registration is not a release approval. */
export const V2_ETH_PROTOCOL = "hylsia-pp-v2-eth" as const;
export type V2PrivacyProtocol = typeof V2_PROTOCOL | typeof V2_ETH_PROTOCOL;
export type PrivacyProtocol = typeof PROTOCOL_VERSION | V2PrivacyProtocol;
export const isV2Protocol = (value: unknown): value is V2PrivacyProtocol =>
  value === V2_PROTOCOL || value === V2_ETH_PROTOCOL;

export const PRIVACY_PROTOCOLS = Object.freeze({
  [PROTOCOL_VERSION]: Object.freeze({
    id: PROTOCOL_VERSION,
    artifactBase: "/zk",
    candidate: false,
  }),
  [V2_PROTOCOL]: Object.freeze({
    id: V2_PROTOCOL,
    artifactBase: "/zk-v2-dev",
    candidate: true,
  }),
  [V2_ETH_PROTOCOL]: Object.freeze({
    id: V2_ETH_PROTOCOL,
    artifactBase: "/zk-v2-eth",
    candidate: false,
  }),
});

export function protocolDefinition(protocol: PrivacyProtocol) {
  if (!Object.hasOwn(PRIVACY_PROTOCOLS, protocol))
    throw new Error(`Unsupported privacy protocol: ${String(protocol)}`);
  return PRIVACY_PROTOCOLS[protocol];
}

/** One protocol per app/server build. A backup envelope version never selects it. */
export function readPrivacyProtocol(
  value: string | undefined,
  variable = "PRIVACY_PROTOCOL"
): PrivacyProtocol {
  const id = value?.trim() || PROTOCOL_VERSION;
  if (!Object.hasOwn(PRIVACY_PROTOCOLS, id))
    throw new Error(`${variable}: unsupported privacy protocol`);
  return id as PrivacyProtocol;
}
