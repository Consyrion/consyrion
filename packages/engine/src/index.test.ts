import { describe, expect, it } from "vitest";
import { ENGINE_CONTRACT_VERSION, engineProblem } from "../contract";
import { engine } from "./index";

describe("private engine", () => {
  it("is the production engine for the current contract", () => {
    expect(engine.info.kind).toBe("production");
    expect(engine.info.contract).toBe(ENGINE_CONTRACT_VERSION);
    expect(engineProblem(engine)).toBeNull();
  });
});
