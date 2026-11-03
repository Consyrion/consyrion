import { describe, expect, it } from "vitest";
import { parseJsonOutput } from "./json";

describe("parseJsonOutput", () => {
  it("parses plain JSON", () => {
    expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
  });
  it("removes a ```json fence", () => {
    expect(parseJsonOutput('```json\n{"title":"SQLite"}\n```')).toEqual({ title: "SQLite" });
  });
  it("removes a thinking block and surrounding prose", () => {
    expect(parseJsonOutput('<think>weighing options…</think>\nHere is the proposal:\n{"title":"PostgreSQL","n":2}\nHope this helps.')).toEqual({ title: "PostgreSQL", n: 2 });
  });
  it("returns undefined for empty or non-JSON answers", () => {
    expect(parseJsonOutput("")).toBeUndefined();
    expect(parseJsonOutput("I cannot answer that.")).toBeUndefined();
    expect(parseJsonOutput("{ broken")).toBeUndefined();
  });
});
