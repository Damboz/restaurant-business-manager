import type { PermissionEffect } from "@prisma/client";

export type PermissionOverride = {
  key: string;
  effect: PermissionEffect | "ALLOW" | "DENY";
};

/**
 * Applies membership-level overrides on top of the role's permission set.
 * A DENY always wins over the role grant; an ALLOW can add a permission the
 * role does not include.
 */
export function resolvePermissions(
  rolePermissions: Iterable<string>,
  overrides: PermissionOverride[] = []
): string[] {
  const resolved = new Set(rolePermissions);

  for (const override of overrides) {
    if (override.effect === "ALLOW") {
      resolved.add(override.key);
    } else {
      resolved.delete(override.key);
    }
  }

  return [...resolved].sort();
}

export function hasPermission(
  permissions: ReadonlySet<string>,
  required: string
): boolean {
  return permissions.has(required);
}
