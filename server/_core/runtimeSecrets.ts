import { readFileSync } from "node:fs";

/** Docker/host secret files for service signers only. Owner/deployer keys are never runtime requirements. */
export function loadRuntimeSecrets(
  env: NodeJS.ProcessEnv = process.env,
  read = (path: string) => readFileSync(path, "utf8")
): void {
  for (const [name, path] of Object.entries(env)) {
    if (
      !/^PRIVACY_(RELAYER|ASP_POSTMAN)_PRIVATE_KEY(?:_\d+)?_FILE$/.test(name) ||
      !path
    )
      continue;
    const target = name.slice(0, -5);
    if (env[target]?.trim())
      throw new Error(`Configure only ${target} or ${name}`);
    try {
      const value = read(path).trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(value))
        throw new Error("invalid service key");
      env[target] = value;
    } catch {
      throw new Error(`Cannot load valid service secret from ${name}`);
    }
  }
}
