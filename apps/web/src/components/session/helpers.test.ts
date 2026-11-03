import { describe, expect, it } from "vitest";
import { readableFormula, type View } from "./helpers";

describe("readableFormula (#181 live test)", () => {
  it("replaces participant ids by model ids and leaves unknown ids as they are", () => {
    const view = { participants: [{ id: "par_73548610ca7c4001a7c6d93366f1a4ab", provider: "openai", modelId: "gpt-5-mini" }] } as unknown as View;
    expect(readableFormula(view, 'evaluator vote weights {"par_73548610ca7c4001a7c6d93366f1a4ab":5,"par_0a":5}')).toBe(
      'evaluator vote weights {"gpt-5-mini":5,"par_0a":5}',
    );
  });
});
