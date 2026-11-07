import { describe, expect, it } from "vitest";
import { briefLanguage } from "../src/prompts";
import { briefBlock } from "../src/prompts";

// Night test 07.11.26: an English brief got German answers from one model.
describe("answer language of the brief", () => {
  it("recognises English, German, French and Spanish briefs and stays silent when unclear", () => {
    expect(
      briefLanguage(
        "A SaaS company with 25 employees needs to choose how its on-call engineers receive critical incident alerts. Every notification must reach the engineer within 5 minutes.",
      ),
    ).toBe("en");
    expect(briefLanguage("Ein Verein mit 300 Mitgliedern will die Verwaltung digitalisieren. Die Lösung muss günstig sein und darf nicht in die USA.")).toBe(
      "de",
    );
    expect(briefLanguage("Une PME doit choisir un outil de support pour les clients et la solution doit être hébergée en Suisse.")).toBe("fr");
    expect(briefLanguage("Una empresa debe elegir el sistema de tickets para los clientes y la solución debe estar en Suiza.")).toBe("es");
    expect(briefLanguage("OK")).toBeNull();
  });

  it("states the answer language after the brief", () => {
    const block = briefBlock({
      idea: "A SaaS company needs to choose how the engineers receive alerts within 5 minutes for the on-call team.",
      goal: "",
      requirements: "",
      repositoryUrl: null,
    });
    expect(block).toContain("Answer language: English");
    expect(block.indexOf("Answer language")).toBeGreaterThan(block.indexOf("</brief>"));
  });
});
