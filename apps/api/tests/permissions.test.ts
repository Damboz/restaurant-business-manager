import type { RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";
import { requirePermission } from "../src/middleware/restaurant.js";
import { resolvePermissions } from "../src/lib/permissions.js";
import {
  createMemberSchema,
  updateMemberSchema
} from "../src/modules/users/users.schemas.js";

describe("permission resolution", () => {
  it("applies allow and deny overrides on top of role grants", () => {
    expect(
      resolvePermissions(
        ["sales.view", "sales.create", "reports.view"],
        [
          { key: "sales.create", effect: "DENY" },
          { key: "expenses.view", effect: "ALLOW" }
        ]
      )
    ).toEqual(["expenses.view", "reports.view", "sales.view"]);
  });

  it("returns a sorted copy without mutating the input", () => {
    const base = ["b.view", "a.view"];
    const result = resolvePermissions(base);

    expect(result).toEqual(["a.view", "b.view"]);
    expect(base).toEqual(["b.view", "a.view"]);
  });
});

describe("requirePermission middleware", () => {
  function run(permissions: Set<string> | undefined, required: string[]) {
    const next = vi.fn();
    const request = { permissions } as unknown as Parameters<RequestHandler>[0];

    requirePermission(...required)(request, {} as never, next);

    return next;
  }

  it("allows a request with the required permission", () => {
    const next = run(new Set(["employees.view", "employees.manage"]), [
      "employees.view"
    ]);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a request without the required permission", () => {
    const next = run(new Set(["employees.view"]), ["employees.manage"]);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN"
    });
  });

  it("rejects a request without restaurant context", () => {
    const next = run(undefined, ["employees.view"]);

    expect(next.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN"
    });
  });
});

describe("user management schemas", () => {
  it("requires a temporary password of the policy length for new users", () => {
    const result = createMemberSchema.safeParse({
      fullName: "Staff Member",
      phone: "0991234567",
      roleKey: "CASHIER",
      password: "short1"
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate permission overrides", () => {
    const result = updateMemberSchema.safeParse({
      permissionOverrides: [
        { key: "sales.view", effect: "ALLOW" },
        { key: "sales.view", effect: "DENY" }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
  });
});
