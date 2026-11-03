import { describe, expect, it } from "vitest";
import { assertCan, can, canAssignRole, isOrgRole } from "./rbac";

describe("rbac", () => {
  it("grants owners everything", () => {
    expect(can("owner", "billing:manage")).toBe(true);
    expect(can("owner", "decision:approve")).toBe(true);
  });

  it("keeps viewers read-only", () => {
    expect(can("viewer", "project:read")).toBe(true);
    expect(can("viewer", "project:write")).toBe(false);
    expect(can("viewer", "credential:read")).toBe(false);
  });

  it("does not let members approve decisions or manage keys", () => {
    expect(can("member", "decision:run")).toBe(true);
    expect(can("member", "decision:approve")).toBe(false);
    expect(can("member", "credential:write")).toBe(false);
  });

  it("denies missing memberships", () => {
    expect(can(null, "project:read")).toBe(false);
    expect(() => assertCan(undefined, "project:read")).toThrow(/project:read/);
  });

  it("limits role assignment", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("member", "viewer")).toBe(false);
  });

  it("validates role strings", () => {
    expect(isOrgRole("admin")).toBe(true);
    expect(isOrgRole("root")).toBe(false);
  });
});
