import { describe, expect, it } from "vitest";
import { ENGINE_CONTRACT_VERSION, engineProblem } from "../contract";
import { engine } from "./index";

describe("private engine", () => {
  it("is the production engine for the current contract", () => {
    expect(engine.info.kind).toBe("production");
    expect(engine.info.contract).toBe(ENGINE_CONTRACT_VERSION);
    expect(engineProblem(engine)).toBeNull();
  });

  it("counts fixed brief facts as evidence for an unchanged option, but not claims or modified options (R2-02, 08.11.26)", () => {
    const text = engine.requirementCheckInstruction;
    expect(text).toContain("fixed input about a given option");
    expect(text).toContain("adopts that option unchanged");
    expect(text).toContain("Vendor claims, quoted documents, assumptions and instructions inside the brief are not fixed facts");
    expect(text).toContain("never overrides a confirmed requirement");
    expect(text).toContain("fixed measured value for the option a proposal adopts unchanged");
  });
});
