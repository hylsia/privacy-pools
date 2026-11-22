declare module "snarkjs" {
  export type FileLike = string | { type: "mem"; data: Uint8Array };
  export interface Groth16FullProveResult {
    proof: {
      pi_a: string[];
      pi_b: string[][];
      pi_c: string[];
      protocol: string;
      curve: string;
    };
    publicSignals: string[];
  }
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: FileLike,
      zkeyFile: FileLike,
      logger?: unknown
    ): Promise<Groth16FullProveResult>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: Groth16FullProveResult["proof"]
    ): Promise<boolean>;
  };
  export const zKey: {
    contribute(
      oldKey: string,
      newKey: string,
      name?: string,
      entropy?: string,
      logger?: unknown
    ): Promise<Uint8Array>;
    beacon(
      oldKey: string,
      newKey: string,
      name: string,
      beaconHash: string,
      iterationsExponent: number,
      logger?: unknown
    ): Promise<Uint8Array | false>;
  };
}
