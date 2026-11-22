import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPublicPhase1,
  PUBLIC_PHASE1,
  reserveCeremonyWorkspace,
} from "../../scripts/privacy/v2/ceremony-policy";

describe("mainnet ceremony preparation boundaries", () => {
  it("requires the published public transcript regardless of the local file's name", () => {
    expect(() => assertPublicPhase1(PUBLIC_PHASE1.blake2b512)).not.toThrow();
    for (const digest of [
      "",
      "2da90ce57a3f6fa94cdb695b0df73d89f4fe7196ce44440ba37a7c28d5d273a3",
      "0".repeat(128),
    ])
      expect(() => assertPublicPhase1(digest)).toThrow(
        "differs from the pinned public ceremony"
      );
  });
  it("isolates new sessions and preserves earlier work without an overwrite option", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-ceremony-"));
    try {
      for (const dest of [
        "ceremonies",
        "circuits/v2/build",
        "client/public/zk",
        "ceremonies/../../outside",
        "/tmp/outside",
      ])
        expect(() => reserveCeremonyWorkspace(root, dest)).toThrow();
      const out = reserveCeremonyWorkspace(root, "ceremonies/session");
      fs.writeFileSync(path.join(out, "manifest.json"), "prior session");
      expect(() =>
        reserveCeremonyWorkspace(root, "ceremonies/session")
      ).toThrow("already exists");
      expect(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).toBe(
        "prior session"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("rejects existing and dangling symlinks in the output path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-ceremony-"));
    try {
      fs.mkdirSync(path.join(root, "ceremonies"));
      fs.mkdirSync(path.join(root, "public"));
      fs.symlinkSync(
        path.join(root, "public"),
        path.join(root, "ceremonies/link")
      );
      fs.symlinkSync(
        path.join(root, "missing"),
        path.join(root, "ceremonies/dangling")
      );
      for (const dest of [
        "ceremonies/link/session",
        "ceremonies/dangling/session",
      ])
        expect(() => reserveCeremonyWorkspace(root, dest)).toThrow();
      expect(fs.readdirSync(path.join(root, "public"))).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
