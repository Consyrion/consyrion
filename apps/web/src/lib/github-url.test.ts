import { describe, expect, it } from "vitest";
import { repositoryFullName } from "./github-url";

describe("repositoryFullName", () => {
  it("extracts owner/repo from GitHub URLs", () => {
    expect(repositoryFullName("https://github.com/acme/sandbox")).toBe("acme/sandbox");
    expect(repositoryFullName(" https://github.com/acme/app.git ")).toBe("acme/app");
    expect(repositoryFullName("https://github.com/acme/app/")).toBe("acme/app");
  });

  it("ignores anything that is not a plain GitHub repository URL", () => {
    expect(repositoryFullName(null)).toBeNull();
    expect(repositoryFullName("https://gitlab.com/acme/app")).toBeNull();
    expect(repositoryFullName("https://github.com/acme")).toBeNull();
    expect(repositoryFullName("https://github.com/acme/app/tree/main")).toBeNull();
  });
});
