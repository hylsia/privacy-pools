/** Match the compiled pool runtime, exact library links, and all four constructor immutables. */
export function assertPoolRuntime(
  artifact: any,
  observed: string,
  libraries: readonly { name: string; address: string }[],
  immutableValues: readonly bigint[]
) {
  let expected = artifact.deployedBytecode.object
    .replace(/^0x/, "")
    .toLowerCase();
  let actual = observed.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(actual) || actual.length !== expected.length)
    throw new Error("Pool runtime length or encoding mismatch");
  const replace = (
    value: string,
    start: number,
    length: number,
    bytes: string
  ) => value.slice(0, start * 2) + bytes + value.slice((start + length) * 2);
  for (const group of Object.values(
    artifact.deployedBytecode.linkReferences
  ) as Record<string, { start: number; length: number }[]>[]) {
    for (const [name, refs] of Object.entries(group)) {
      const address = libraries
        .find(lib => lib.name === name)
        ?.address.replace(/^0x/, "")
        .toLowerCase();
      if (!address || !/^[0-9a-f]{40}$/.test(address))
        throw new Error("Missing pool library link");
      for (const ref of refs) {
        if (ref.length !== 20)
          throw new Error("Invalid pool library reference");
        expected = replace(expected, ref.start, ref.length, address);
      }
    }
  }
  const allowed = new Set(
    immutableValues.map(value => value.toString(16).padStart(64, "0"))
  );
  const seen = new Set<string>();
  for (const refs of Object.values(
    artifact.deployedBytecode.immutableReferences
  ) as { start: number; length: number }[][]) {
    let value: string | undefined;
    for (const ref of refs) {
      if (ref.length !== 32) throw new Error("Unexpected immutable width");
      const next = actual.slice(ref.start * 2, (ref.start + ref.length) * 2);
      if (!allowed.has(next) || (value && next !== value))
        throw new Error("Pool immutable value mismatch");
      value = next;
      expected = replace(expected, ref.start, ref.length, "0".repeat(64));
      actual = replace(actual, ref.start, ref.length, "0".repeat(64));
    }
    if (value) seen.add(value);
  }
  if (seen.size !== allowed.size || expected !== actual)
    throw new Error("Deployed pool runtime differs from reviewed release");
}
