import { DomainError } from "@consyrion/core";
import { ENGINE_CONTRACT_VERSION } from "@consyrion/engine/contract";
import { describe, expect, it, vi } from "vitest";

const installed = vi.hoisted(() => ({ kind: "stub" as "stub" | "test" | "production", contract: 0 }));
vi.mock("@consyrion/engine", () => ({
  engine: {
    get info() {
      return { kind: installed.kind, name: "mocked", contract: installed.contract };
    },
  },
}));

installed.contract = ENGINE_CONTRACT_VERSION;
const { assertEngineInstalled, engineInfo } = await import("../src/engine-guard");

describe("engine guard (#188)", () => {
  it("refuses council work without an engine, with ENGINE_NOT_INSTALLED", () => {
    installed.kind = "stub";
    let error: unknown;
    try {
      assertEngineInstalled();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("CONFIGURATION");
    expect((error as DomainError).details).toEqual({ code: "ENGINE_NOT_INSTALLED" });
  });

  it("refuses an engine built for another contract", () => {
    installed.kind = "production";
    installed.contract = 99;
    expect(() => assertEngineInstalled()).toThrow(/contract 99/);
    installed.contract = ENGINE_CONTRACT_VERSION;
  });

  it("accepts only the production engine where production requires it", () => {
    process.env.CONSYRION_REQUIRE_PRODUCTION_ENGINE = "1";
    try {
      installed.kind = "test";
      expect(() => assertEngineInstalled()).toThrow(/requires the production CONSYRION engine/);
      installed.kind = "production";
      expect(() => assertEngineInstalled()).not.toThrow();
    } finally {
      delete process.env.CONSYRION_REQUIRE_PRODUCTION_ENGINE;
    }
  });

  it("accepts the production and the test engine", () => {
    for (const kind of ["production", "test"] as const) {
      installed.kind = kind;
      expect(() => assertEngineInstalled()).not.toThrow();
      expect(engineInfo().kind).toBe(kind);
    }
  });
});
