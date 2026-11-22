import { mainnetTarget } from "../../shared/privacy/mainnetTargets";

/** Select a single explicit deployment network. All remaining flags are validated by the caller. */
export function selectMainnetTarget(argv: readonly string[]) {
  const args: string[] = [];
  let selected: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--network") {
      args.push(argv[i]);
      continue;
    }
    if (selected !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error(
        "Use --network once with ethereum-mainnet or robinhood-mainnet"
      );
    selected = argv[++i];
  }
  return { args, target: mainnetTarget(selected) };
}
