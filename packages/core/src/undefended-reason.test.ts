import { describe, expect, it } from "vitest";
import { callErrorKindText, undefendedReasonText } from "./undefended-reason";

describe("undefendedReasonText", () => {
  it("words every reason the engine stores in the reader's language", () => {
    expect(undefendedReasonText("the author's answer was unusable (schema)", "de")).toBe(
      "die Antwort des Autors war nicht verwertbar (nicht im erwarteten Format)",
    );
    expect(undefendedReasonText("provider error (rate limit)", "de")).toBe("Anbieterfehler (Anfragelimit erreicht)");
    expect(undefendedReasonText("the author's answer was cut off at the output limit", "fr")).toBe("la réponse de l’auteur a été coupée à la limite de sortie");
    expect(undefendedReasonText("the author's call failed", "es")).toBe("la llamada del autor falló");
    expect(undefendedReasonText("provider error (timeout)", "zh")).toBe("提供方错误(超时)");
  });

  it("leaves no English engine wording for any stored kind", () => {
    const kinds = [
      "timeout",
      "rate limit",
      "overloaded",
      "network",
      "auth",
      "model not found",
      "bad request",
      "provider error",
      "credential",
      "schema",
      "mismatch",
      "refusal",
    ];
    for (const locale of ["de", "fr", "es", "zh"])
      for (const kind of kinds)
        for (const reason of [`provider error (${kind})`, `the author's answer was unusable (${kind})`])
          expect(undefendedReasonText(reason, locale)).not.toMatch(/author|provider error|unusable/);
  });

  it("keeps English and unknown sentences as stored", () => {
    expect(undefendedReasonText("the author's answer was unusable (schema)", "en")).toBe("the author's answer was unusable (schema)");
    expect(undefendedReasonText("something new", "de")).toBe("something new");
    expect(undefendedReasonText("provider error (brand new kind)", "de")).toBe("Anbieterfehler (brand new kind)");
  });

  it("QA 12.11.26: words a bare call error kind for the Council Room", () => {
    expect(callErrorKindText("schema", "de")).not.toBe("schema");
    expect(callErrorKindText("rate_limit", "de")).toBe("Anfragelimit erreicht");
    expect(callErrorKindText("schema", "en")).toBe("schema");
    expect(callErrorKindText("brand_new", "de")).toBe("brand new");
  });
});
