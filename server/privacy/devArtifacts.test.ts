import { afterEach, describe, expect, it, vi } from "vitest";
import { registerV2DevelopmentAssets } from "./devArtifacts";
import { resetPrivacyConfig } from "./config";
import { V2_PROTOCOL } from "../../shared/privacy/protocols";

afterEach(() => {
  vi.unstubAllEnvs();
  resetPrivacyConfig();
});
describe("v2 development artifact exposure", () => {
  it("never registers a development-key route in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRIVACY_PROTOCOL", V2_PROTOCOL);
    const get = vi.fn();
    registerV2DevelopmentAssets({ get } as never);
    expect(get).not.toHaveBeenCalled();
  });
  it("does not register a v2 artifact route for the default v1 development app", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PRIVACY_PROTOCOL", "hylsia-pp-v1");
    const get = vi.fn();
    registerV2DevelopmentAssets({ get } as never);
    expect(get).not.toHaveBeenCalled();
  });
  it("refuses non-loopback requests before reading any development artifact", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PRIVACY_PROTOCOL", V2_PROTOCOL);
    vi.stubEnv("PRIVACY_CHAIN_IDS", "31337");
    const get = vi.fn();
    registerV2DevelopmentAssets({ get } as never);
    expect(get.mock.calls[0][0]).toBe("/zk-v2-dev/:file");
    const sendStatus = vi.fn();
    get.mock.calls[0][1](
      {
        socket: { remoteAddress: "203.0.113.10" },
        params: { file: "withdraw.zkey" },
      },
      { sendStatus }
    );
    expect(sendStatus).toHaveBeenCalledWith(403);
  });
});
