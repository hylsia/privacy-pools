import { describe, it, expect, vi } from "vitest";
import { assessHealth } from "./health";
import type { ASPStatusAnswer } from "../../shared/privacy/api";
import { loadRuntimeSecrets } from "../_core/runtimeSecrets";
import { securityHeaders } from "../_core/securityHeaders";
const answer = (due: boolean, canPublish = true, running = true) =>
  ({
    pools: [
      {
        chainId: 46630,
        pool: "0x1111111111111111111111111111111111111111",
        canPublish,
        screening: {
          rootDue: due,
          exclusions: "ok",
          autoPublish: { running, seconds: 600 },
        },
      },
    ],
    unavailable: [],
  }) as unknown as ASPStatusAnswer;
describe("hosting readiness, no transaction path", () => {
  it("keeps manual publisher traffic available while reporting the due wallet action", () => {
    const manual = answer(true, false, false);
    manual.pools[0].chainId = 1;
    Object.assign(manual.pools[0].screening!, { publicationMode: "wallet", walletPublishable: true });
    expect(assessHealth(manual, 0).ok).toBe(true);
    const waiting = assessHealth(manual, 1_300_000);
    expect(waiting.ok).toBe(true);
    expect(waiting.pools[0]).toMatchObject({ walletPublicationDue: true, problems: [] });
    manual.pools[0].screening!.walletPublishable = false;
    expect(assessHealth(manual, 1_300_001).ok).toBe(false);
  });
  it("does not flag old roots when there is nothing to publish; monitors due work and RPC failure", () => {
    expect(assessHealth(answer(false, false, false), 0).ok).toBe(true);
    expect(assessHealth(answer(true, false), 0).pools[0].problems).toContain(
      "publisher_unavailable"
    );
    expect(
      assessHealth(answer(true, true), 1_200_001).pools[0].problems
    ).toContain("eligible_root_overdue");
    expect(assessHealth(answer(false), 1_200_002).ok).toBe(true);
    expect(
      assessHealth({
        pools: [],
        unavailable: [{ chainId: 46630 }],
      } as ASPStatusAnswer).ok
    ).toBe(false);
    expect(
      assessHealth(answer(true, true, false), 1_200_003).pools[0].problems
    ).toContain("publisher_schedule_off");
  });
  it("loads only service signer files and reports names without secret contents or paths", () => {
    const env = {
      PRIVACY_RELAYER_PRIVATE_KEY_FILE: "/secret/relayer",
      PRIVACY_DEPLOYER_PRIVATE_KEY_FILE: "/secret/owner",
    };
    const read = vi.fn(() => `0x${"01".repeat(32)}\n`);
    loadRuntimeSecrets(env, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(Object.keys(env)).toContain("PRIVACY_RELAYER_PRIVATE_KEY");
    expect(() => loadRuntimeSecrets(env, read)).toThrow(
      "Configure only PRIVACY_RELAYER_PRIVATE_KEY or PRIVACY_RELAYER_PRIVATE_KEY_FILE"
    );
    expect(() =>
      loadRuntimeSecrets(
        { PRIVACY_ASP_POSTMAN_PRIVATE_KEY_FILE: "/private/location" },
        () => {
          throw new Error("secret contents");
        }
      )
    ).toThrow(
      /^Cannot load valid service secret from PRIVACY_ASP_POSTMAN_PRIVATE_KEY_FILE$/
    );
  });
  it("sets headers for WASM, workers, injected wallets and explicitly configured HTTPS RPC/relayers", () => {
    const headers = new Map<string, string>();
    const next = vi.fn();
    securityHeaders(true)(
      {} as never,
      { setHeader: (k: string, v: string) => headers.set(k, v) } as never,
      next
    );
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Content-Security-Policy")).toContain(
      "'wasm-unsafe-eval'"
    );
    expect(headers.get("Content-Security-Policy")).toContain(
      "worker-src 'self' blob:"
    );
    expect(headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self' https:"
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
