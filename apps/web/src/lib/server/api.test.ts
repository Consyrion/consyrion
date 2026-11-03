import { DomainError } from "@consyrion/core";
import { describe, expect, it, vi } from "vitest";
import { handle, readJson, toErrorResponse } from "./api";

describe("API error mapping", () => {
  it("maps domain errors to HTTP status codes", async () => {
    expect(toErrorResponse(new DomainError("FORBIDDEN", "nope")).status).toBe(403);
    expect(toErrorResponse(new DomainError("UNAUTHENTICATED", "x")).status).toBe(401);
    const response = toErrorResponse(new DomainError("VALIDATION", "bad", { fieldErrors: { name: ["required"] } }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION", details: { fieldErrors: { name: ["required"] } } } });
  });

  it("hides unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The structured logger only records the error type, never its message.
    const response = await handle(async () => {
      throw new Error("db password=hunter2 leaked");
    })();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("rejects non-JSON bodies", async () => {
    await expect(readJson(new Request("http://x", { method: "POST", body: "not json" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
